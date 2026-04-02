/* ===================================================================
   工事写真 電子黒板 PWA - Main Application
   =================================================================== */

// ─── Field definitions ───
const FIELD_LABELS = {
  constructionName: '工事名',
  workType: '工種',
  category: '種別',
  subcategory: '細別',
  location: '撮影箇所',
  date: '撮影日',
  contractor: '受注者',
  notes: '備考',
};

const ALL_FIELDS = ['constructionName','workType','category','subcategory','location','date','contractor','notes'];

// ─── Blackboard Templates ───
const BB_TEMPLATES = [
  {
    id: 'standard-green',
    name: '標準（緑）',
    cssClass: 'bb-green',
    fields: ALL_FIELDS,
    layout: 'vertical',
    hasFrame: true,
    titleText: '工事写真',
  },
  {
    id: 'standard-black',
    name: '標準（黒）',
    cssClass: 'bb-black',
    fields: ALL_FIELDS,
    layout: 'vertical',
    hasFrame: true,
    titleText: '工事写真',
  },
  {
    id: 'whiteboard',
    name: 'ホワイトボード',
    cssClass: 'bb-white',
    fields: ALL_FIELDS,
    layout: 'vertical',
    hasFrame: false,
    titleText: '工事写真',
  },
  {
    id: 'simple-green',
    name: '簡易（緑）',
    cssClass: 'bb-green bb-compact',
    fields: ['constructionName','location','date','contractor'],
    layout: 'vertical',
    hasFrame: true,
    titleText: '工事写真',
  },
  {
    id: 'horizontal',
    name: '横型（緑）',
    cssClass: 'bb-green',
    fields: ['constructionName','workType','category','location','date','contractor'],
    layout: 'horizontal',
    hasFrame: true,
    titleText: '工事写真',
  },
  {
    id: 'freeform',
    name: '自由記述',
    cssClass: 'bb-green',
    fields: [],
    layout: 'freeform',
    hasFrame: true,
    titleText: '工事写真',
    freeformField: true,
  },
];

// ─── Default Master Data ───
const DEFAULT_MASTERS = {
  workType: ['建築工事','土木工事','電気工事','機械設備工事','給排水工事','外構工事','解体工事'],
  category: ['躯体工事','仕上工事','基礎工事','鉄骨工事','木工事','防水工事','塗装工事','内装工事'],
};

// ═══════════════════════════════════════════════════════════════
// App State
// ═══════════════════════════════════════════════════════════════
const App = {
  db: null,
  currentProject: null,
  currentTemplate: BB_TEMPLATES[0],
  bbData: {},
  bbPosition: { x: 10, y: null }, // y=null means auto (bottom)
  bbScale: 60,
  bbOpacity: 0,
  stream: null,
  photos: [],
  settings: {
    company: '',
    manager: '',
    quality: 0.85,
    saveToCameraRoll: true,
    gps: true,
  },
  masters: { ...DEFAULT_MASTERS },
  editingProjectId: null,
  currentMasterKey: null,
  viewingPhotoId: null,
  gpsPosition: null,

  // ─── Init ───
  async init() {
    await this.initDB();
    await this.loadSettings();
    await this.loadMasters();
    this.renderProjectList();
    this.initBBDrag();
    this.renderTemplateGrid();

    // Watch GPS
    if (this.settings.gps && navigator.geolocation) {
      navigator.geolocation.watchPosition(
        pos => { this.gpsPosition = pos.coords; },
        () => {},
        { enableHighAccuracy: true }
      );
    }

    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // IndexedDB
  // ═══════════════════════════════════════════════════════════════
  initDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ConstructionPhotoDB', 2);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  },

  dbPut(store, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  dbGet(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  dbGetAll(store) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  dbGetByIndex(store, indexName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(indexName);
      const req = idx.getAll(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  dbDelete(store, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════
  async loadSettings() {
    const data = await this.dbGet('settings', 'app-settings');
    if (data) this.settings = { ...this.settings, ...data.value };
  },

  async loadMasters() {
    const data = await this.dbGet('settings', 'masters');
    if (data) this.masters = { ...DEFAULT_MASTERS, ...data.value };
  },

  showSettings() {
    document.getElementById('setting-company').value = this.settings.company || '';
    document.getElementById('setting-manager').value = this.settings.manager || '';
    document.getElementById('setting-quality').value = String(this.settings.quality);
    document.getElementById('setting-save-camera-roll').checked = this.settings.saveToCameraRoll;
    document.getElementById('setting-gps').checked = this.settings.gps;
    this.switchScreen('screen-settings');
  },

  async saveSettings() {
    this.settings.company = document.getElementById('setting-company').value;
    this.settings.manager = document.getElementById('setting-manager').value;
    this.settings.quality = parseFloat(document.getElementById('setting-quality').value);
    this.settings.saveToCameraRoll = document.getElementById('setting-save-camera-roll').checked;
    this.settings.gps = document.getElementById('setting-gps').checked;
    await this.dbPut('settings', { key: 'app-settings', value: this.settings });
    this.toast('設定を保存しました');
    this.showHome();
  },

  // Master Editor
  showMasterEditor(key) {
    this.currentMasterKey = key;
    const title = key === 'workType' ? '工種マスタ' : '種別マスタ';
    document.getElementById('master-editor-title').textContent = title;
    this.renderMasterList();
    this.openModal('modal-master');
  },

  renderMasterList() {
    const list = document.getElementById('master-list');
    const items = this.masters[this.currentMasterKey] || [];
    list.innerHTML = items.map((item, i) => `
      <div class="master-item">
        <span>${this.esc(item)}</span>
        <button class="btn-icon" onclick="App.removeMasterItem(${i})" style="color:var(--danger);font-size:16px;">&#10005;</button>
      </div>
    `).join('');
  },

  async addMasterItem() {
    const input = document.getElementById('master-new-item');
    const val = input.value.trim();
    if (!val) return;
    if (!this.masters[this.currentMasterKey]) this.masters[this.currentMasterKey] = [];
    this.masters[this.currentMasterKey].push(val);
    await this.dbPut('settings', { key: 'masters', value: this.masters });
    input.value = '';
    this.renderMasterList();
  },

  async removeMasterItem(index) {
    this.masters[this.currentMasterKey].splice(index, 1);
    await this.dbPut('settings', { key: 'masters', value: this.masters });
    this.renderMasterList();
  },

  // ═══════════════════════════════════════════════════════════════
  // Screen Navigation
  // ═══════════════════════════════════════════════════════════════
  switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  },

  showHome() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.renderProjectList();
    this.switchScreen('screen-home');
  },

  // ═══════════════════════════════════════════════════════════════
  // Project Management
  // ═══════════════════════════════════════════════════════════════
  async renderProjectList() {
    const projects = await this.dbGetAll('projects');
    const container = document.getElementById('project-list');

    if (projects.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>&#128247;</p>
          <p>右下の＋ボタンで新規物件を追加してください</p>
        </div>`;
      return;
    }

    // Count photos per project
    const allPhotos = await this.dbGetAll('photos');
    const counts = {};
    allPhotos.forEach(p => { counts[p.projectId] = (counts[p.projectId] || 0) + 1; });

    container.innerHTML = projects
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(p => `
        <div class="project-card" onclick="App.openProject('${p.id}')">
          <div class="project-card-icon">&#128215;</div>
          <div class="project-card-info">
            <h3>${this.esc(p.name)}</h3>
            <p>${this.esc(p.location || '場所未設定')}</p>
          </div>
          <div class="project-card-count">${counts[p.id] || 0}枚</div>
          <div class="project-card-actions">
            <button class="btn-icon" onclick="event.stopPropagation();App.editProject('${p.id}')" style="font-size:16px;">&#9998;</button>
            <button class="btn-icon" onclick="event.stopPropagation();App.deleteProject('${p.id}')" style="font-size:16px;color:var(--danger);">&#128465;</button>
          </div>
        </div>
      `).join('');
  },

  showProjectEditor(id) {
    this.editingProjectId = id || null;
    document.getElementById('project-editor-title').textContent = id ? '物件編集' : '新規物件';
    if (id) {
      this.dbGet('projects', id).then(p => {
        if (!p) return;
        document.getElementById('proj-name').value = p.name || '';
        document.getElementById('proj-location').value = p.location || '';
        document.getElementById('proj-contractor').value = p.contractor || '';
        document.getElementById('proj-start').value = p.startDate || '';
        document.getElementById('proj-end').value = p.endDate || '';
      });
    } else {
      document.getElementById('proj-name').value = '';
      document.getElementById('proj-location').value = '';
      document.getElementById('proj-contractor').value = this.settings.company || '';
      document.getElementById('proj-start').value = '';
      document.getElementById('proj-end').value = '';
    }
    this.openModal('modal-project');
  },

  async saveProject() {
    const name = document.getElementById('proj-name').value.trim();
    if (!name) { this.toast('工事名を入力してください'); return; }

    const project = {
      id: this.editingProjectId || ('proj_' + Date.now()),
      name,
      location: document.getElementById('proj-location').value.trim(),
      contractor: document.getElementById('proj-contractor').value.trim(),
      startDate: document.getElementById('proj-start').value,
      endDate: document.getElementById('proj-end').value,
      updatedAt: Date.now(),
    };

    await this.dbPut('projects', project);
    this.closeModal('modal-project');
    this.renderProjectList();
    this.toast('物件を保存しました');
  },

  editProject(id) {
    this.showProjectEditor(id);
  },

  async deleteProject(id) {
    if (!confirm('この物件と関連する写真をすべて削除しますか？')) return;
    // Delete photos
    const photos = await this.dbGetByIndex('photos', 'projectId', id);
    for (const p of photos) {
      await this.dbDelete('photos', p.id);
    }
    await this.dbDelete('projects', id);
    this.renderProjectList();
    this.toast('物件を削除しました');
  },

  // ═══════════════════════════════════════════════════════════════
  // Open Project → Camera
  // ═══════════════════════════════════════════════════════════════
  async openProject(id) {
    const project = await this.dbGet('projects', id);
    if (!project) return;
    this.currentProject = project;

    // Init blackboard data from project
    this.bbData = {
      constructionName: project.name || '',
      workType: '',
      category: '',
      subcategory: '',
      location: '',
      date: this.todayStr(),
      contractor: project.contractor || this.settings.company || '',
      notes: '',
      freeText: '',
    };

    // Load last used bb data for this project
    const saved = await this.dbGet('settings', 'bbdata-' + id);
    if (saved) {
      this.bbData = { ...this.bbData, ...saved.value, date: this.todayStr() };
    }

    // Load last template
    const savedTpl = await this.dbGet('settings', 'bbtemplate-' + id);
    if (savedTpl) {
      const tpl = BB_TEMPLATES.find(t => t.id === savedTpl.value);
      if (tpl) this.currentTemplate = tpl;
    }

    await this.startCamera();
  },

  // ═══════════════════════════════════════════════════════════════
  // Camera
  // ═══════════════════════════════════════════════════════════════
  async startCamera() {
    document.getElementById('camera-project-name').textContent = this.currentProject.name;
    this.switchScreen('screen-camera');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 4032 },
          height: { ideal: 3024 },
        },
        audio: false,
      });
      const video = document.getElementById('camera-video');
      video.srcObject = this.stream;
      await video.play();
    } catch (err) {
      this.toast('カメラにアクセスできません: ' + err.message);
    }

    // Render blackboard
    this.renderBlackboard();

    // Load recent gallery thumb
    this.updateGalleryThumb();
  },

  closeCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    // Save bb data
    if (this.currentProject) {
      this.dbPut('settings', { key: 'bbdata-' + this.currentProject.id, value: this.bbData });
      this.dbPut('settings', { key: 'bbtemplate-' + this.currentProject.id, value: this.currentTemplate.id });
    }
    this.showHome();
  },

  showCamera() {
    this.switchScreen('screen-camera');
  },

  toggleFlash() {
    if (!this.stream) return;
    const track = this.stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.();
    if (caps && caps.torch) {
      const current = track.getSettings().torch || false;
      track.applyConstraints({ advanced: [{ torch: !current }] });
      this.toast(!current ? 'フラッシュ ON' : 'フラッシュ OFF');
    } else {
      this.toast('このデバイスではフラッシュを制御できません');
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Photo Capture
  // ═══════════════════════════════════════════════════════════════
  async capturePhoto() {
    const video = document.getElementById('camera-video');
    if (!video.videoWidth) { this.toast('カメラの準備ができていません'); return; }

    const canvas = document.getElementById('camera-canvas');
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');

    // Draw video frame
    ctx.drawImage(video, 0, 0, vw, vh);

    // Draw blackboard on canvas
    this.drawBlackboardOnCanvas(ctx, vw, vh);

    // Flash effect
    const flash = document.createElement('div');
    flash.className = 'capture-flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 400);

    // Convert to blob
    const quality = this.settings.quality || 0.85;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    const dataUrl = await this.blobToDataUrl(blob);

    // Save to DB
    const photoId = 'photo_' + Date.now();
    const photo = {
      id: photoId,
      projectId: this.currentProject.id,
      dataUrl,
      timestamp: Date.now(),
      bbData: { ...this.bbData },
      templateId: this.currentTemplate.id,
      gps: this.gpsPosition ? { lat: this.gpsPosition.latitude, lng: this.gpsPosition.longitude } : null,
    };
    await this.dbPut('photos', photo);

    // Also save to camera roll if enabled
    if (this.settings.saveToCameraRoll) {
      try {
        const a = document.createElement('a');
        a.href = dataUrl;
        const dateStr = this.bbData.date.replace(/\//g, '');
        a.download = `${this.currentProject.name}_${this.bbData.location || 'photo'}_${dateStr}_${photoId.slice(-4)}.jpg`;
        // On iPad Safari, direct download may not work; use share API if available
        if (navigator.share && navigator.canShare) {
          const file = new File([blob], a.download, { type: 'image/jpeg' });
          if (navigator.canShare({ files: [file] })) {
            // Don't auto-share, just note it's available
          }
        }
      } catch (e) { /* silent */ }
    }

    // Update gallery thumb
    this.updateGalleryThumb();

    this.toast('撮影しました');
  },

  drawBlackboardOnCanvas(ctx, canvasW, canvasH) {
    const overlay = document.getElementById('blackboard-overlay');
    const container = document.querySelector('.camera-container');
    if (!overlay.firstChild) return;

    const containerRect = container.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();

    // Calculate position ratio
    const scaleX = canvasW / containerRect.width;
    const scaleY = canvasH / containerRect.height;

    const bbX = (overlayRect.left - containerRect.left) * scaleX;
    const bbY = (overlayRect.top - containerRect.top) * scaleY;
    const bbW = overlayRect.width * scaleX;
    const bbH = overlayRect.height * scaleY;

    const tpl = this.currentTemplate;
    const data = this.bbData;
    const opacity = 1 - (this.bbOpacity / 100);

    ctx.save();
    ctx.globalAlpha = opacity;

    // Background
    if (tpl.cssClass.includes('bb-white')) {
      ctx.fillStyle = '#f5f5f0';
    } else if (tpl.cssClass.includes('bb-black')) {
      ctx.fillStyle = '#1a1a1a';
    } else {
      ctx.fillStyle = '#1e5a2f';
    }

    // Frame
    if (tpl.hasFrame) {
      const frameWidth = 4 * scaleX;
      ctx.fillStyle = '#8B7332';
      ctx.fillRect(bbX - frameWidth, bbY - frameWidth, bbW + frameWidth * 2, bbH + frameWidth * 2);
    }

    // Board background
    if (tpl.cssClass.includes('bb-white')) {
      ctx.fillStyle = '#f5f5f0';
    } else if (tpl.cssClass.includes('bb-black')) {
      ctx.fillStyle = '#222222';
    } else {
      ctx.fillStyle = '#24593a';
    }
    ctx.fillRect(bbX, bbY, bbW, bbH);

    // Text color
    const textColor = tpl.cssClass.includes('bb-white') ? '#222222' : '#ffffff';
    const borderColor = tpl.cssClass.includes('bb-white') ? '#999999' : 'rgba(255,255,255,0.4)';

    // Title bar
    const titleH = bbH * 0.12;
    if (tpl.cssClass.includes('bb-white')) {
      ctx.fillStyle = '#e0e0d8';
    } else if (tpl.cssClass.includes('bb-black')) {
      ctx.fillStyle = '#111111';
    } else {
      ctx.fillStyle = '#1a4a28';
    }
    ctx.fillRect(bbX, bbY, bbW, titleH);

    ctx.fillStyle = textColor;
    const titleFontSize = Math.max(12, titleH * 0.6);
    ctx.font = `bold ${titleFontSize}px 'Hiragino Kaku Gothic ProN', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tpl.titleText, bbX + bbW / 2, bbY + titleH / 2);

    // Title border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bbX, bbY + titleH);
    ctx.lineTo(bbX + bbW, bbY + titleH);
    ctx.stroke();

    // Fields
    if (tpl.layout === 'freeform') {
      const bodyY = bbY + titleH + 4;
      const bodyH = bbH - titleH - 4;
      ctx.fillStyle = textColor;
      const freeSize = Math.max(10, bodyH * 0.1);
      ctx.font = `${freeSize}px 'Hiragino Kaku Gothic ProN', sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const lines = (data.freeText || '').split('\n');
      lines.forEach((line, i) => {
        ctx.fillText(line, bbX + 8, bodyY + 4 + i * (freeSize + 4), bbW - 16);
      });
    } else {
      const fields = tpl.fields;
      const rowH = (bbH - titleH) / (fields.length || 1);
      const labelW = bbW * 0.28;

      fields.forEach((field, i) => {
        const rowY = bbY + titleH + i * rowH;

        // Row border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        if (i > 0) {
          ctx.beginPath();
          ctx.moveTo(bbX, rowY);
          ctx.lineTo(bbX + bbW, rowY);
          ctx.stroke();
        }

        // Label/Value divider
        ctx.beginPath();
        ctx.moveTo(bbX + labelW, rowY);
        ctx.lineTo(bbX + labelW, rowY + rowH);
        ctx.stroke();

        // Label
        const fontSize = Math.max(9, rowH * 0.45);
        ctx.fillStyle = textColor;
        ctx.font = `bold ${fontSize}px 'Hiragino Kaku Gothic ProN', sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(FIELD_LABELS[field] || field, bbX + 6, rowY + rowH / 2, labelW - 10);

        // Value
        ctx.font = `${fontSize}px 'Hiragino Kaku Gothic ProN', sans-serif`;
        const val = data[field] || '';
        ctx.fillText(val, bbX + labelW + 6, rowY + rowH / 2, bbW - labelW - 12);
      });
    }

    // Outer border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(bbX, bbY, bbW, bbH);

    ctx.restore();
  },

  blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Blackboard Rendering (HTML overlay)
  // ═══════════════════════════════════════════════════════════════
  renderBlackboard() {
    const container = document.getElementById('blackboard-overlay');
    const tpl = this.currentTemplate;
    const data = this.bbData;

    let frameClass = tpl.hasFrame ? ' bb-wood-frame' : '';
    let html = `<div class="bb ${tpl.cssClass}${frameClass}" onclick="App.showBBEditor()">`;

    // Title
    html += `<div class="bb-title-bar">${this.esc(tpl.titleText)}</div>`;

    if (tpl.layout === 'freeform') {
      html += `<div class="bb-free-body">${this.esc(data.freeText || 'タップして入力')}</div>`;
    } else {
      html += '<table class="bb-table"><tbody>';
      tpl.fields.forEach(field => {
        const val = data[field] || '';
        html += `<tr><th>${FIELD_LABELS[field]}</th><td>${this.esc(val) || '&nbsp;'}</td></tr>`;
      });
      html += '</tbody></table>';
    }

    html += '<div class="bb-tap-hint">タップして編集</div>';
    html += '</div>';

    container.innerHTML = html;

    // Apply scale & position
    const scalePct = this.bbScale / 100;
    const maxWidth = tpl.layout === 'horizontal' ? 350 : 240;
    container.style.width = (maxWidth * scalePct) + 'px';

    const cameraContainer = document.querySelector('.camera-container');
    const ch = cameraContainer?.offsetHeight || window.innerHeight;

    if (this.bbPosition.y === null) {
      this.bbPosition.y = ch - container.offsetHeight - 120;
    }
    container.style.left = this.bbPosition.x + 'px';
    container.style.top = this.bbPosition.y + 'px';

    // Apply opacity
    const bbEl = container.querySelector('.bb');
    if (bbEl) bbEl.style.opacity = 1 - (this.bbOpacity / 100);
  },

  setBlackboardOpacity(val) {
    this.bbOpacity = parseInt(val);
    const bbEl = document.querySelector('#blackboard-overlay .bb');
    if (bbEl) bbEl.style.opacity = 1 - (this.bbOpacity / 100);
  },

  setBlackboardScale(val) {
    this.bbScale = parseInt(val);
    this.renderBlackboard();
  },

  // ─── Blackboard Drag ───
  initBBDrag() {
    const overlay = document.getElementById('blackboard-overlay');
    let dragging = false;
    let startX, startY, origX, origY;
    let moved = false;

    const onStart = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      dragging = true;
      moved = false;
      startX = touch.clientX;
      startY = touch.clientY;
      origX = overlay.offsetLeft;
      origY = overlay.offsetTop;
    };

    const onMove = (e) => {
      if (!dragging) return;
      const touch = e.touches ? e.touches[0] : e;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
      if (moved) {
        e.preventDefault();
        this.bbPosition.x = origX + dx;
        this.bbPosition.y = origY + dy;
        overlay.style.left = this.bbPosition.x + 'px';
        overlay.style.top = this.bbPosition.y + 'px';
      }
    };

    const onEnd = () => {
      dragging = false;
    };

    overlay.addEventListener('touchstart', onStart, { passive: true });
    overlay.addEventListener('touchmove', onMove, { passive: false });
    overlay.addEventListener('touchend', onEnd);
    overlay.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  },

  // ═══════════════════════════════════════════════════════════════
  // Blackboard Editor
  // ═══════════════════════════════════════════════════════════════
  showBBEditor() {
    const container = document.getElementById('bb-editor-fields');
    const tpl = this.currentTemplate;
    let html = '';

    if (tpl.layout === 'freeform') {
      html += `<label>自由記述<textarea id="bb-edit-freeText" rows="6">${this.esc(this.bbData.freeText || '')}</textarea></label>`;
    } else {
      tpl.fields.forEach(field => {
        const label = FIELD_LABELS[field];
        const val = this.bbData[field] || '';

        if (field === 'date') {
          const isoDate = this.bbData.date ? this.bbData.date.replace(/\//g, '-') : '';
          html += `<label>${label}<input type="date" id="bb-edit-${field}" value="${isoDate}"></label>`;
        } else if (field === 'notes') {
          html += `<label>${label}<textarea id="bb-edit-${field}" rows="3">${this.esc(val)}</textarea></label>`;
        } else if (field === 'workType') {
          html += `<label>${label}<input type="text" id="bb-edit-${field}" value="${this.esc(val)}" list="list-workType"></label>`;
          html += `<datalist id="list-workType">${this.masters.workType.map(v => `<option value="${this.esc(v)}">`).join('')}</datalist>`;
          html += this.renderSuggestions(field, this.masters.workType);
        } else if (field === 'category') {
          html += `<label>${label}<input type="text" id="bb-edit-${field}" value="${this.esc(val)}" list="list-category"></label>`;
          html += `<datalist id="list-category">${this.masters.category.map(v => `<option value="${this.esc(v)}">`).join('')}</datalist>`;
          html += this.renderSuggestions(field, this.masters.category);
        } else {
          html += `<label>${label}<input type="text" id="bb-edit-${field}" value="${this.esc(val)}"></label>`;
        }

        // Add history suggestions for location
        if (field === 'location') {
          this.getLocationHistory().then(history => {
            if (history.length > 0) {
              const chips = document.getElementById('suggest-location');
              if (chips) {
                chips.innerHTML = history.map(v =>
                  `<span class="suggestion-chip" onclick="document.getElementById('bb-edit-location').value='${this.esc(v)}'">${this.esc(v)}</span>`
                ).join('');
              }
            }
          });
          html += `<div class="suggestion-chips" id="suggest-location"></div>`;
        }
      });
    }

    container.innerHTML = html;
    this.openModal('modal-bb-editor');
  },

  renderSuggestions(field, items) {
    return `<div class="suggestion-chips">${items.slice(0, 8).map(v =>
      `<span class="suggestion-chip" onclick="document.getElementById('bb-edit-${field}').value='${this.esc(v)}'">${this.esc(v)}</span>`
    ).join('')}</div>`;
  },

  async getLocationHistory() {
    if (!this.currentProject) return [];
    const photos = await this.dbGetByIndex('photos', 'projectId', this.currentProject.id);
    const locations = [...new Set(photos.map(p => p.bbData?.location).filter(Boolean))];
    return locations.slice(-10);
  },

  saveBBEdit() {
    const tpl = this.currentTemplate;
    if (tpl.layout === 'freeform') {
      const el = document.getElementById('bb-edit-freeText');
      if (el) this.bbData.freeText = el.value;
    } else {
      tpl.fields.forEach(field => {
        const el = document.getElementById('bb-edit-' + field);
        if (!el) return;
        if (field === 'date') {
          this.bbData[field] = el.value.replace(/-/g, '/');
        } else {
          this.bbData[field] = el.value;
        }
      });
    }
    this.closeModal('modal-bb-editor');
    this.renderBlackboard();
    // Persist
    if (this.currentProject) {
      this.dbPut('settings', { key: 'bbdata-' + this.currentProject.id, value: this.bbData });
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Template Selector
  // ═══════════════════════════════════════════════════════════════
  showTemplateSelector() {
    this.renderTemplateGrid();
    this.openModal('modal-template');
  },

  renderTemplateGrid() {
    const grid = document.getElementById('template-grid');
    if (!grid) return;

    grid.innerHTML = BB_TEMPLATES.map(tpl => {
      const selected = tpl.id === this.currentTemplate.id ? ' selected' : '';
      const previewData = {
        constructionName: '○○工事',
        workType: '建築',
        category: '躯体',
        subcategory: 'コンクリート',
        location: '1F柱C1',
        date: this.todayStr(),
        contractor: '○○建設',
        notes: '',
        freeText: '自由にメモを\n記入できます',
      };

      let preview = `<div class="bb ${tpl.cssClass}${tpl.hasFrame ? ' bb-wood-frame' : ''}" style="width:180px;font-size:9px;">`;
      preview += `<div class="bb-title-bar" style="font-size:10px;padding:2px 4px;">${tpl.titleText}</div>`;

      if (tpl.layout === 'freeform') {
        preview += `<div class="bb-free-body" style="font-size:9px;min-height:30px;">${this.esc(previewData.freeText)}</div>`;
      } else {
        preview += '<table class="bb-table"><tbody>';
        tpl.fields.forEach(field => {
          preview += `<tr><th style="font-size:8px;width:50px;padding:1px 3px;">${FIELD_LABELS[field]}</th><td style="font-size:8px;padding:1px 3px;">${this.esc(previewData[field]) || ''}</td></tr>`;
        });
        preview += '</tbody></table>';
      }
      preview += '</div>';

      return `
        <div class="template-card${selected}" onclick="App.selectTemplate('${tpl.id}')">
          <div class="template-preview">${preview}</div>
          <div class="template-name">${tpl.name}</div>
        </div>`;
    }).join('');
  },

  selectTemplate(id) {
    const tpl = BB_TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    this.currentTemplate = tpl;
    this.closeModal('modal-template');
    this.renderBlackboard();
    this.toast(`${tpl.name} を選択しました`);
  },

  // ═══════════════════════════════════════════════════════════════
  // Gallery
  // ═══════════════════════════════════════════════════════════════
  async showGallery() {
    if (!this.currentProject) return;
    document.getElementById('gallery-title').textContent = this.currentProject.name + ' - 写真一覧';
    this.switchScreen('screen-gallery');
    await this.renderGallery();
  },

  async renderGallery() {
    const photos = await this.dbGetByIndex('photos', 'projectId', this.currentProject.id);
    const grid = document.getElementById('gallery-grid');

    if (photos.length === 0) {
      grid.innerHTML = '<div class="empty-state"><p>&#128247;</p><p>まだ写真がありません</p></div>';
      return;
    }

    photos.sort((a, b) => b.timestamp - a.timestamp);

    grid.innerHTML = photos.map(p => {
      const date = new Date(p.timestamp);
      const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
      const loc = p.bbData?.location || '';
      return `
        <div class="gallery-item" onclick="App.viewPhoto('${p.id}')">
          <img src="${p.dataUrl}" alt="写真" loading="lazy">
          <div class="gallery-item-info">${dateStr} ${this.esc(loc)}</div>
        </div>`;
    }).join('');
  },

  async viewPhoto(id) {
    const photo = await this.dbGet('photos', id);
    if (!photo) return;
    this.viewingPhotoId = id;
    document.getElementById('photo-viewer-img').src = photo.dataUrl;
    const date = new Date(photo.timestamp);
    const info = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    document.getElementById('photo-viewer-info').textContent = info + (photo.bbData?.location ? ' - ' + photo.bbData.location : '');
    this.openModal('modal-photo-viewer');
  },

  async deletePhoto() {
    if (!this.viewingPhotoId) return;
    if (!confirm('この写真を削除しますか？')) return;
    await this.dbDelete('photos', this.viewingPhotoId);
    this.viewingPhotoId = null;
    this.closeModal('modal-photo-viewer');
    this.renderGallery();
    this.updateGalleryThumb();
    this.toast('写真を削除しました');
  },

  async updateGalleryThumb() {
    if (!this.currentProject) return;
    const photos = await this.dbGetByIndex('photos', 'projectId', this.currentProject.id);
    const thumb = document.getElementById('gallery-thumb');
    if (photos.length > 0) {
      photos.sort((a, b) => b.timestamp - a.timestamp);
      thumb.style.backgroundImage = `url(${photos[0].dataUrl})`;
    } else {
      thumb.style.backgroundImage = '';
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Export
  // ═══════════════════════════════════════════════════════════════
  async exportPhotos() {
    if (!this.currentProject) return;
    const photos = await this.dbGetByIndex('photos', 'projectId', this.currentProject.id);
    if (photos.length === 0) { this.toast('写真がありません'); return; }

    // Try share API for multiple files
    if (navigator.share && navigator.canShare) {
      try {
        const files = await Promise.all(photos.map(async (p, i) => {
          const res = await fetch(p.dataUrl);
          const blob = await res.blob();
          const dateStr = (p.bbData?.date || '').replace(/\//g, '');
          const name = `${this.currentProject.name}_${p.bbData?.location || ''}_${dateStr}_${String(i + 1).padStart(3, '0')}.jpg`;
          return new File([blob], name, { type: 'image/jpeg' });
        }));

        if (navigator.canShare({ files })) {
          await navigator.share({
            title: this.currentProject.name + ' 工事写真',
            files,
          });
          return;
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          this.toast('共有に失敗しました');
        }
        return;
      }
    }

    // Fallback: download one by one
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const a = document.createElement('a');
      a.href = p.dataUrl;
      const dateStr = (p.bbData?.date || '').replace(/\//g, '');
      a.download = `${this.currentProject.name}_${p.bbData?.location || ''}_${dateStr}_${String(i + 1).padStart(3, '0')}.jpg`;
      a.click();
    }
    this.toast(`${photos.length}枚の写真をエクスポートしました`);
  },

  // ═══════════════════════════════════════════════════════════════
  // Data Export / Import
  // ═══════════════════════════════════════════════════════════════
  async exportAllData() {
    const projects = await this.dbGetAll('projects');
    const photos = await this.dbGetAll('photos');
    const data = { projects, photosMeta: photos.map(p => ({ ...p, dataUrl: undefined })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `construction_photo_data_${this.todayStr().replace(/\//g, '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('データをエクスポートしました');
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.projects) {
          for (const p of data.projects) {
            await this.dbPut('projects', p);
          }
        }
        this.renderProjectList();
        this.toast('データをインポートしました');
      } catch (err) {
        this.toast('インポートに失敗しました');
      }
    };
    input.click();
  },

  // ═══════════════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════════════
  todayStr() {
    const d = new Date();
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  },

  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  openModal(id) {
    document.getElementById(id).classList.add('active');
  },

  closeModal(id) {
    document.getElementById(id).classList.remove('active');
  },

  toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  },
};

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => App.init());
