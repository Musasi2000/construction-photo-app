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
  {
    id: 'custom',
    name: 'カスタム',
    cssClass: 'bb-green',
    fields: ALL_FIELDS,
    layout: 'vertical',
    hasFrame: true,
    titleText: '工事写真',
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
  bbScale: 80,
  bbOpacity: 0,
  bbFrameColor: '#8B7332',
  bbHiddenFields: [], // fields hidden by user
  bbCustomLabels: {}, // field -> custom label name
  bbRowHeight: 10, // row padding in px
  bbBorderWidth: 1, // table border width in px
  bbFrameWidth: 6,  // outer frame width in px
  bbCellPad: 8,     // text margin in px
  bbDateFormat: 'slash', // 'slash' = 2026/04/03, 'kanji' = 2026年04月03日
  savedPresets: [],  // user-saved blackboard presets
  FRAME_COLORS: [
    { name: '木目', color: '#8B7332' },
    { name: '焦茶', color: '#4A2F1B' },
    { name: '黒', color: '#333333' },
    { name: '白', color: '#CCCCCC' },
    { name: '銀', color: '#888899' },
    { name: '赤', color: '#8B2020' },
    { name: '青', color: '#1E3A6E' },
    { name: '緑', color: '#2E5A2E' },
    { name: '金', color: '#B8860B' },
  ],
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
    await this.loadPresets();
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

    // Load hidden fields
    const savedHidden = await this.dbGet('settings', 'bbhidden-' + id);
    this.bbHiddenFields = savedHidden ? savedHidden.value : [];

    // Load custom labels
    const savedLabels = await this.dbGet('settings', 'bblabels-' + id);
    this.bbCustomLabels = savedLabels ? savedLabels.value : {};

    // Load date format
    const savedDateFmt = await this.dbGet('settings', 'bbdatefmt-' + id);
    this.bbDateFormat = savedDateFmt ? savedDateFmt.value : 'slash';

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

    // Render blackboard + frame color picker
    this.renderBlackboard();
    this.renderFrameColorPicker();

    // Load recent gallery thumb
    this.updateGalleryThumb();
  },

  renderFrameColorPicker() {
    const container = document.getElementById('frame-color-picker');
    if (!container) return;
    container.innerHTML = this.FRAME_COLORS.map(fc => {
      const sel = fc.color === this.bbFrameColor ? ' selected' : '';
      return `<div class="frame-color-swatch${sel}" style="background:${fc.color};" title="${fc.name}" onclick="App.setFrameColor('${fc.color}')"></div>`;
    }).join('');
  },

  setFrameColor(color) {
    this.bbFrameColor = color;
    this.renderBlackboard();
    this.renderFrameColorPicker();
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

    // Frame - draw thick border around the board
    if (tpl.hasFrame) {
      const fw = this.bbFrameWidth * scaleX * (this.bbScale / 100);
      ctx.fillStyle = this.bbFrameColor;
      ctx.fillRect(bbX - fw, bbY - fw, bbW + fw * 2, bbH + fw * 2);
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
    const borderColor = tpl.cssClass.includes('bb-white') ? '#999999' : '#ffffff';

    // Title bar removed
    const titleH = 0;

    // Fields
    if (tpl.layout === 'freeform') {
      const bodyY = bbY + 4;
      const bodyH = bbH - 4;
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
      // Build rows: custom rows or filtered fields
      let rows;
      if (tpl.id === 'custom') {
        rows = (data.customRows || []).filter(r => r.label || r.value).map(r => ({ label: r.label, value: r.value }));
      } else {
        const visibleFields = tpl.fields.filter(f => !this.bbHiddenFields.includes(f));
        rows = visibleFields.map(f => ({ label: this.getFieldLabel(f), value: data[f] || '' }));
      }

      const rowH = (bbH - titleH) / (rows.length || 1);
      const labelW = bbW * 0.32;
      const cellPad = this.bbCellPad * scaleX * (this.bbScale / 100);
      const canvasBorderW = Math.max(1, this.bbBorderWidth * scaleX * (this.bbScale / 100));

      rows.forEach((row, i) => {
        const rowY = bbY + titleH + i * rowH;

        // Row border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = canvasBorderW;
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
        ctx.fillText(row.label, bbX + cellPad, rowY + rowH / 2, labelW - cellPad * 2);

        // Value
        ctx.font = `${fontSize}px 'Hiragino Kaku Gothic ProN', sans-serif`;
        ctx.fillText(row.value, bbX + labelW + cellPad, rowY + rowH / 2, bbW - labelW - cellPad * 2);
      });
    }

    // Outer border
    const outerBorderW = Math.max(2, this.bbBorderWidth * 2 * scaleX * (this.bbScale / 100));
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = outerBorderW;
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

    let frameStyle = tpl.hasFrame ? ` border: ${this.bbFrameWidth}px solid ${this.bbFrameColor};` : '';
    let html = `<div class="bb ${tpl.cssClass}" style="${frameStyle}" onclick="App.showBBEditor()">`;

    // Title bar removed per user request

    if (tpl.layout === 'freeform') {
      html += `<div class="bb-free-body">${this.esc(data.freeText || 'タップして入力')}</div>`;
    } else if (tpl.id === 'custom') {
      const rows = data.customRows || [
        { label: '工事名', value: data.constructionName || '' },
        { label: '撮影箇所', value: data.location || '' },
        { label: '撮影日', value: data.date || '' },
        { label: '受注者', value: data.contractor || '' },
      ];
      const cs = `padding:${this.bbRowHeight}px ${this.bbCellPad}px;border-width:${this.bbBorderWidth}px`;
      html += '<table class="bb-table"><tbody>';
      rows.forEach(row => {
        if (row.label || row.value) {
          html += `<tr><th style="${cs}">${this.esc(row.label)}</th><td style="${cs}">${this.esc(row.value) || '&nbsp;'}</td></tr>`;
        }
      });
      html += '</tbody></table>';
    } else {
      const cs = `padding:${this.bbRowHeight}px ${this.bbCellPad}px;border-width:${this.bbBorderWidth}px`;
      const visibleFields = tpl.fields.filter(f => !this.bbHiddenFields.includes(f));
      html += '<table class="bb-table"><tbody>';
      visibleFields.forEach(field => {
        const val = data[field] || '';
        html += `<tr><th style="${cs}">${this.esc(this.getFieldLabel(field))}</th><td style="${cs}">${this.esc(val) || '&nbsp;'}</td></tr>`;
      });
      html += '</tbody></table>';
    }

    html += '<div class="bb-tap-hint">タップして編集</div>';
    html += '</div>';

    container.innerHTML = html;

    // Apply scale using transform (maintains aspect ratio)
    const baseWidth = tpl.layout === 'horizontal' ? 320 : 260;
    container.style.width = baseWidth + 'px';
    const scalePct = this.bbScale / 100;
    container.style.transform = `scale(${scalePct})`;
    container.style.transformOrigin = 'top left';

    const cameraContainer = document.querySelector('.camera-container');
    const ch = cameraContainer?.offsetHeight || window.innerHeight;

    if (this.bbPosition.y === null) {
      this.bbPosition.y = ch - (container.offsetHeight * scalePct) - 120;
    }
    container.style.left = this.bbPosition.x + 'px';
    container.style.top = this.bbPosition.y + 'px';

    // Apply opacity
    const bbEl = container.querySelector('.bb');
    if (bbEl) bbEl.style.opacity = 1 - (this.bbOpacity / 100);
  },

  // Unified control sync: slider ↔ number input
  syncControl(name, val) {
    const v = parseFloat(val);
    const controls = {
      opacity:     { state: 'bbOpacity',     slider: 'bb-opacity',       num: 'bb-opacity-num',       rerender: false },
      scale:       { state: 'bbScale',       slider: 'bb-scale',         num: 'bb-scale-num',         rerender: true },
      rowHeight:   { state: 'bbRowHeight',   slider: 'bb-row-height',    num: 'bb-row-height-num',    rerender: false },
      borderWidth: { state: 'bbBorderWidth', slider: 'bb-border-width',  num: 'bb-border-width-num',  rerender: false },
      frameWidth:  { state: 'bbFrameWidth',  slider: 'bb-frame-width',   num: 'bb-frame-width-num',   rerender: false },
      cellPad:     { state: 'bbCellPad',     slider: 'bb-cell-pad',      num: 'bb-cell-pad-num',      rerender: false },
    };
    const c = controls[name];
    if (!c) return;
    this[c.state] = v;

    // Sync slider ↔ number
    const slider = document.getElementById(c.slider);
    const num = document.getElementById(c.num);
    if (slider) slider.value = v;
    if (num) num.value = v;

    if (c.rerender) {
      this.renderBlackboard();
      return;
    }

    // Apply without full re-render
    if (name === 'opacity') {
      const bbEl = document.querySelector('#blackboard-overlay .bb');
      if (bbEl) bbEl.style.opacity = 1 - (this.bbOpacity / 100);
    } else if (name === 'rowHeight' || name === 'borderWidth' || name === 'cellPad') {
      document.querySelectorAll('#blackboard-overlay .bb-table td, #blackboard-overlay .bb-table th').forEach(cell => {
        cell.style.padding = `${this.bbRowHeight}px ${this.bbCellPad}px`;
        cell.style.borderWidth = `${this.bbBorderWidth}px`;
      });
    } else if (name === 'frameWidth') {
      const bbEl = document.querySelector('#blackboard-overlay .bb');
      if (bbEl && this.currentTemplate.hasFrame) {
        bbEl.style.borderWidth = `${this.bbFrameWidth}px`;
      }
    }
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

    // Field visibility toggles (not for freeform or custom)
    if (tpl.layout !== 'freeform' && tpl.id !== 'custom') {
      html += '<div style="margin-bottom:16px;"><span style="font-size:14px;color:var(--accent);font-weight:600;">表示項目</span>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
      tpl.fields.forEach(field => {
        const checked = !this.bbHiddenFields.includes(field) ? 'checked' : '';
        html += `<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--text);background:var(--bg-surface);padding:6px 10px;border-radius:8px;border:1px solid var(--border);cursor:pointer;">`;
        html += `<input type="checkbox" ${checked} onchange="App.toggleFieldVisibility('${field}')" style="width:18px;height:18px;">${FIELD_LABELS[field]}</label>`;
      });
      html += '</div></div>';
      html += '<div style="border-bottom:1px solid var(--border);margin-bottom:16px;"></div>';
    }

    if (tpl.layout === 'freeform') {
      html += `<label>自由記述<textarea id="bb-edit-freeText" rows="6">${this.esc(this.bbData.freeText || '')}</textarea></label>`;
    } else if (tpl.id === 'custom') {
      // Custom template: editable labels and values
      const rows = this.bbData.customRows || [
        { label: '工事名', value: this.bbData.constructionName || '' },
        { label: '撮影箇所', value: this.bbData.location || '' },
        { label: '撮影日', value: this.bbData.date || '' },
        { label: '受注者', value: this.bbData.contractor || '' },
      ];
      html += '<div id="custom-rows">';
      rows.forEach((row, i) => {
        html += `<div style="display:flex;gap:8px;margin-bottom:10px;align-items:center;">`;
        html += `<input type="text" id="custom-label-${i}" value="${this.esc(row.label)}" placeholder="項目名" style="width:90px;min-height:44px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);color:var(--text);font-size:14px;">`;
        html += `<input type="text" id="custom-value-${i}" value="${this.esc(row.value)}" placeholder="内容" style="flex:1;min-height:44px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface);color:var(--text);font-size:14px;">`;
        html += `<button onclick="App.removeCustomRow(${i})" style="width:36px;height:36px;border:none;background:var(--danger);color:white;border-radius:50%;font-size:18px;cursor:pointer;">✕</button>`;
        html += `</div>`;
      });
      html += '</div>';
      html += `<button onclick="App.addCustomRow()" style="width:100%;padding:12px;border:1px dashed var(--border);background:transparent;color:var(--text-secondary);border-radius:8px;font-size:14px;cursor:pointer;">＋ 行を追加</button>`;
    } else {
      const visibleFields = tpl.fields.filter(f => !this.bbHiddenFields.includes(f));
      visibleFields.forEach(field => {
        const defaultLabel = FIELD_LABELS[field];
        const currentLabel = this.getFieldLabel(field);
        const val = this.bbData[field] || '';

        // Label editor row
        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">`;
        html += `<input type="text" id="bb-label-${field}" value="${this.esc(currentLabel)}" placeholder="${defaultLabel}" style="width:100px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg-surface);color:var(--accent);font-size:13px;font-weight:600;min-height:36px;">`;
        if (this.bbCustomLabels[field]) {
          html += `<button onclick="App.resetFieldLabel('${field}')" style="border:none;background:none;color:var(--text-secondary);font-size:11px;cursor:pointer;white-space:nowrap;">リセット</button>`;
        }
        html += `</div>`;

        if (field === 'date') {
          const isoDate = this.dateToIso(this.bbData.date);
          html += `<label style="margin-left:0;"><input type="date" id="bb-edit-${field}" value="${isoDate}"></label>`;
          html += `<div style="display:flex;gap:8px;margin-top:4px;margin-bottom:8px;">`;
          html += `<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--text);background:var(--bg-surface);padding:6px 10px;border-radius:8px;border:1px solid ${this.bbDateFormat==='slash'?'var(--accent)':'var(--border)'};cursor:pointer;">`;
          html += `<input type="radio" name="dateFormat" value="slash" ${this.bbDateFormat==='slash'?'checked':''} onchange="App.bbDateFormat='slash'"> 2026/04/03</label>`;
          html += `<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--text);background:var(--bg-surface);padding:6px 10px;border-radius:8px;border:1px solid ${this.bbDateFormat==='kanji'?'var(--accent)':'var(--border)'};cursor:pointer;">`;
          html += `<input type="radio" name="dateFormat" value="kanji" ${this.bbDateFormat==='kanji'?'checked':''} onchange="App.bbDateFormat='kanji'"> 2026年04月03日</label>`;
          html += `</div>`;
        } else if (field === 'notes') {
          html += `<label style="margin-left:0;"><textarea id="bb-edit-${field}" rows="3">${this.esc(val)}</textarea></label>`;
        } else if (field === 'workType') {
          html += `<label style="margin-left:0;"><input type="text" id="bb-edit-${field}" value="${this.esc(val)}" list="list-workType"></label>`;
          html += `<datalist id="list-workType">${this.masters.workType.map(v => `<option value="${this.esc(v)}">`).join('')}</datalist>`;
          html += this.renderSuggestions(field, this.masters.workType);
        } else if (field === 'category') {
          html += `<label style="margin-left:0;"><input type="text" id="bb-edit-${field}" value="${this.esc(val)}" list="list-category"></label>`;
          html += `<datalist id="list-category">${this.masters.category.map(v => `<option value="${this.esc(v)}">`).join('')}</datalist>`;
          html += this.renderSuggestions(field, this.masters.category);
        } else {
          html += `<label style="margin-left:0;"><input type="text" id="bb-edit-${field}" value="${this.esc(val)}"></label>`;
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

  resetFieldLabel(field) {
    delete this.bbCustomLabels[field];
    this.showBBEditor(); // re-render
  },

  toggleFieldVisibility(field) {
    const idx = this.bbHiddenFields.indexOf(field);
    if (idx >= 0) {
      this.bbHiddenFields.splice(idx, 1);
    } else {
      this.bbHiddenFields.push(field);
    }
  },

  addCustomRow() {
    if (!this.bbData.customRows) this.bbData.customRows = [];
    // Save current rows first
    this._readCustomRows();
    this.bbData.customRows.push({ label: '', value: '' });
    this.showBBEditor(); // re-render
  },

  removeCustomRow(index) {
    this._readCustomRows();
    this.bbData.customRows.splice(index, 1);
    this.showBBEditor(); // re-render
  },

  _readCustomRows() {
    const rows = [];
    let i = 0;
    while (true) {
      const lbl = document.getElementById('custom-label-' + i);
      const val = document.getElementById('custom-value-' + i);
      if (!lbl || !val) break;
      rows.push({ label: lbl.value, value: val.value });
      i++;
    }
    if (rows.length > 0) this.bbData.customRows = rows;
  },

  saveBBEdit() {
    const tpl = this.currentTemplate;
    if (tpl.layout === 'freeform') {
      const el = document.getElementById('bb-edit-freeText');
      if (el) this.bbData.freeText = el.value;
    } else if (tpl.id === 'custom') {
      this._readCustomRows();
    } else {
      const visibleFields = tpl.fields.filter(f => !this.bbHiddenFields.includes(f));
      visibleFields.forEach(field => {
        // Save custom label
        const labelEl = document.getElementById('bb-label-' + field);
        if (labelEl) {
          const newLabel = labelEl.value.trim();
          if (newLabel && newLabel !== FIELD_LABELS[field]) {
            this.bbCustomLabels[field] = newLabel;
          } else {
            delete this.bbCustomLabels[field];
          }
        }
        // Save value
        const el = document.getElementById('bb-edit-' + field);
        if (!el) return;
        if (field === 'date') {
          this.bbData[field] = this.isoToDisplay(el.value);
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
      this.dbPut('settings', { key: 'bbhidden-' + this.currentProject.id, value: this.bbHiddenFields });
      this.dbPut('settings', { key: 'bblabels-' + this.currentProject.id, value: this.bbCustomLabels });
      this.dbPut('settings', { key: 'bbdatefmt-' + this.currentProject.id, value: this.bbDateFormat });
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Template Selector
  // ═══════════════════════════════════════════════════════════════
  showTemplateSelector() {
    this.renderSavedPresets();
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

      let frameStyle = tpl.hasFrame ? `border:${this.bbFrameWidth}px solid ${this.bbFrameColor};` : '';
      let preview = `<div class="bb ${tpl.cssClass}" style="width:180px;font-size:9px;${frameStyle}">`;
      // Title bar removed

      if (tpl.layout === 'freeform') {
        preview += `<div class="bb-free-body" style="font-size:9px;min-height:30px;">${this.esc(previewData.freeText)}</div>`;
      } else if (tpl.id === 'custom') {
        const customPreview = [
          { label: '項目A', value: '自由入力' },
          { label: '項目B', value: '自由入力' },
          { label: '日付', value: this.todayStr() },
        ];
        preview += '<table class="bb-table"><tbody>';
        customPreview.forEach(r => {
          preview += `<tr><th style="font-size:8px;width:50px;padding:1px 3px;">${r.label}</th><td style="font-size:8px;padding:1px 3px;">${r.value}</td></tr>`;
        });
        preview += '</tbody></table>';
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
  // Preset Save / Load / Delete
  // ═══════════════════════════════════════════════════════════════
  async loadPresets() {
    const data = await this.dbGet('settings', 'bb-presets');
    this.savedPresets = data ? data.value : [];
  },

  async _savePresets() {
    await this.dbPut('settings', { key: 'bb-presets', value: this.savedPresets });
  },

  _captureCurrentSettings() {
    return {
      templateId: this.currentTemplate.id,
      scale: this.bbScale,
      opacity: this.bbOpacity,
      frameColor: this.bbFrameColor,
      frameWidth: this.bbFrameWidth,
      cellPad: this.bbCellPad,
      rowHeight: this.bbRowHeight,
      borderWidth: this.bbBorderWidth,
      dateFormat: this.bbDateFormat,
      hiddenFields: [...this.bbHiddenFields],
      customLabels: { ...this.bbCustomLabels },
      bbData: { ...this.bbData },
    };
  },

  _applyPreset(preset) {
    // Restore template
    const tpl = BB_TEMPLATES.find(t => t.id === preset.templateId);
    if (tpl) this.currentTemplate = tpl;

    // Restore all settings
    if (preset.scale != null) this.bbScale = preset.scale;
    if (preset.opacity != null) this.bbOpacity = preset.opacity;
    if (preset.frameColor) this.bbFrameColor = preset.frameColor;
    if (preset.frameWidth != null) this.bbFrameWidth = preset.frameWidth;
    if (preset.cellPad != null) this.bbCellPad = preset.cellPad;
    if (preset.rowHeight != null) this.bbRowHeight = preset.rowHeight;
    if (preset.borderWidth != null) this.bbBorderWidth = preset.borderWidth;
    if (preset.dateFormat) this.bbDateFormat = preset.dateFormat;
    if (preset.hiddenFields) this.bbHiddenFields = [...preset.hiddenFields];
    if (preset.customLabels) this.bbCustomLabels = { ...preset.customLabels };
    if (preset.bbData) this.bbData = { ...this.bbData, ...preset.bbData };

    // Sync UI controls
    this._syncAllControls();
  },

  _syncAllControls() {
    const pairs = [
      ['bb-opacity', 'bb-opacity-num', this.bbOpacity],
      ['bb-scale', 'bb-scale-num', this.bbScale],
      ['bb-row-height', 'bb-row-height-num', this.bbRowHeight],
      ['bb-border-width', 'bb-border-width-num', this.bbBorderWidth],
      ['bb-frame-width', 'bb-frame-width-num', this.bbFrameWidth],
      ['bb-cell-pad', 'bb-cell-pad-num', this.bbCellPad],
    ];
    pairs.forEach(([sliderId, numId, val]) => {
      const s = document.getElementById(sliderId);
      const n = document.getElementById(numId);
      if (s) s.value = val;
      if (n) n.value = val;
    });
    this.renderFrameColorPicker();
  },

  saveCurrentAsPreset() {
    const name = prompt('黒板の名前を入力してください：');
    if (!name || !name.trim()) return;

    const preset = {
      id: 'preset_' + Date.now(),
      name: name.trim(),
      ...this._captureCurrentSettings(),
      createdAt: Date.now(),
    };
    this.savedPresets.push(preset);
    this._savePresets();
    this.renderTemplateGrid();
    this.renderSavedPresets();
    this.toast(`「${preset.name}」を保存しました`);
  },

  loadPresetById(id) {
    const preset = this.savedPresets.find(p => p.id === id);
    if (!preset) return;
    this._applyPreset(preset);
    this.closeModal('modal-template');
    this.renderBlackboard();
    this.toast(`「${preset.name}」を読み込みました`);
  },

  deletePresetById(id) {
    const preset = this.savedPresets.find(p => p.id === id);
    if (!preset) return;
    if (!confirm(`「${preset.name}」を削除しますか？`)) return;
    this.savedPresets = this.savedPresets.filter(p => p.id !== id);
    this._savePresets();
    this.renderSavedPresets();
    this.toast('削除しました');
  },

  renderSavedPresets() {
    const grid = document.getElementById('saved-preset-grid');
    if (!grid) return;

    if (this.savedPresets.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">保存された黒板はありません</p>';
      return;
    }

    grid.innerHTML = this.savedPresets.map(preset => {
      const tpl = BB_TEMPLATES.find(t => t.id === preset.templateId) || BB_TEMPLATES[0];
      const fw = preset.frameWidth || 6;
      const fc = preset.frameColor || '#8B7332';
      const frameStyle = tpl.hasFrame ? `border:${Math.min(fw, 4)}px solid ${fc};` : '';

      let preview = `<div class="bb ${tpl.cssClass}" style="width:180px;font-size:9px;${frameStyle}">`;
      preview += '<table class="bb-table"><tbody>';

      // Show a few fields from saved data
      const sampleFields = ['constructionName', 'workType', 'location', 'date'];
      const hidden = preset.hiddenFields || [];
      const labels = preset.customLabels || {};
      const data = preset.bbData || {};

      if (tpl.id === 'custom' && data.customRows) {
        data.customRows.slice(0, 4).forEach(r => {
          if (r.label || r.value) {
            preview += `<tr><th style="font-size:8px;width:50px;padding:1px 3px;">${this.esc(r.label)}</th><td style="font-size:8px;padding:1px 3px;">${this.esc(r.value) || ''}</td></tr>`;
          }
        });
      } else {
        const visibleFields = (tpl.fields || ALL_FIELDS).filter(f => !hidden.includes(f));
        visibleFields.slice(0, 5).forEach(f => {
          const lbl = labels[f] || FIELD_LABELS[f] || f;
          const val = data[f] || '';
          preview += `<tr><th style="font-size:8px;width:50px;padding:1px 3px;">${this.esc(lbl)}</th><td style="font-size:8px;padding:1px 3px;">${this.esc(val) || ''}</td></tr>`;
        });
      }
      preview += '</tbody></table></div>';

      return `
        <div class="template-card" onclick="App.loadPresetById('${preset.id}')">
          <div class="template-preview">${preview}</div>
          <div class="template-name-row">
            <span>${this.esc(preset.name)}</span>
            <button class="template-delete-btn" onclick="event.stopPropagation();App.deletePresetById('${preset.id}')">&#128465;</button>
          </div>
        </div>`;
    }).join('');
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

  async savePhotoToDevice() {
    if (!this.viewingPhotoId) return;
    const photo = await this.dbGet('photos', this.viewingPhotoId);
    if (!photo) return;

    const dateStr = (photo.bbData?.date || '').replace(/\//g, '');
    const loc = photo.bbData?.location || 'photo';
    const projName = this.currentProject?.name || 'construction';
    const fileName = `${projName}_${loc}_${dateStr}.jpg`;

    // Try Web Share API with file (best for iPad Safari)
    try {
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }

    // Fallback: download link
    const a = document.createElement('a');
    a.href = photo.dataUrl;
    a.download = fileName;
    a.click();
    this.toast('写真を保存しました');
  },

  async sharePhoto() {
    if (!this.viewingPhotoId) return;
    const photo = await this.dbGet('photos', this.viewingPhotoId);
    if (!photo) return;

    const dateStr = (photo.bbData?.date || '').replace(/\//g, '');
    const loc = photo.bbData?.location || 'photo';
    const projName = this.currentProject?.name || 'construction';
    const fileName = `${projName}_${loc}_${dateStr}.jpg`;

    try {
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      if (navigator.share) {
        await navigator.share({
          title: `${projName} - ${loc}`,
          files: [file],
        });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
    this.toast('共有機能が利用できません');
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
  getFieldLabel(field) {
    return this.bbCustomLabels[field] || FIELD_LABELS[field] || field;
  },

  todayStr() {
    const d = new Date();
    return this.formatDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  },

  formatDate(y, m, d) {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    if (this.bbDateFormat === 'kanji') {
      return `${y}年${mm}月${dd}日`;
    }
    return `${y}/${mm}/${dd}`;
  },

  // Convert any date string to ISO (yyyy-mm-dd) for <input type="date">
  dateToIso(str) {
    if (!str) return '';
    // Handle 2026年04月03日
    const kanjiMatch = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (kanjiMatch) return `${kanjiMatch[1]}-${kanjiMatch[2].padStart(2,'0')}-${kanjiMatch[3].padStart(2,'0')}`;
    // Handle 2026/04/03
    return str.replace(/\//g, '-');
  },

  // Convert ISO date to current format
  isoToDisplay(iso) {
    if (!iso) return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return this.formatDate(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
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
