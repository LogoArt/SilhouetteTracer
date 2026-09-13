import { ImageSegmenter, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm";

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const svgContainer = document.getElementById('svg-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const originalPreview = document.getElementById('original-preview');
const editor = document.getElementById('editor');

const qualitySlider = document.getElementById('quality-slider');
const qualityValueDisplay = document.getElementById('quality-value');
const thresholdSlider = document.getElementById('threshold-slider');
const thresholdValueDisplay = document.getElementById('threshold-value');
const resolutionSlider = document.getElementById('resolution-slider');
const resValueDisplay = document.getElementById('res-value');
const offsetSlider = document.getElementById('offset-slider');
const offsetValueDisplay = document.getElementById('offset-value');
const strokeWidthSlider = document.getElementById('stroke-width');
const widthValueDisplay = document.getElementById('width-value');
const strokeLinejoinSelect = document.getElementById('stroke-linejoin');

const fillHolesToggle = document.getElementById('fill-holes-toggle');
const toggleBgCheckbox = document.getElementById('toggle-bg-checkbox');
const downloadSvgBtn = document.getElementById('download-svg-btn');
const downloadPngBtn = document.getElementById('download-png-btn');

const renderModeRadios = document.querySelectorAll('input[name="render-mode"]');
const seedInput = document.getElementById('seed-input');
const loadSeedBtn = document.getElementById('load-seed-btn');
const currentSeedDisplay = document.getElementById('current-seed-display');
const copySeedBtn = document.getElementById('copy-seed-btn');

const fillColorBtns = document.querySelectorAll('#fill-palette .color-btn');
const bgColorBtns = document.querySelectorAll('#bg-palette .color-btn');

let currentFillColor = 'none';
let currentBgColor = 'transparent';
let currentRenderMode = 'fill';
let currentRawFile = null;

const hiddenCanvas = document.getElementById('hidden-canvas');
const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

let imageSegmenter;
let originalImage = new Image();
let aiMaskCanvas = document.createElement('canvas');
let rawConfidenceMask = null;

const PADDING = 150; 

const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');

function updateHamburgerColor() {
    const isSidebarClosed = !sidebar.classList.contains('open');
    const isDarkBg = (currentBgColor !== '#ffffff' && currentBgColor !== 'transparent');
    
    if (isSidebarClosed && isDarkBg) {
        menuBtn.classList.add('light');
    } else {
        menuBtn.classList.remove('light');
    }
}

menuBtn.classList.add('open');
sidebar.classList.add('open');
editor.classList.add('shifted');

menuBtn.addEventListener('click', () => {
    menuBtn.classList.toggle('open');
    sidebar.classList.toggle('open');
    editor.classList.toggle('shifted');
    updateHamburgerColor();
});

const advHeader = document.getElementById('adv-settings-header');
const advContent = document.getElementById('adv-settings-content');
const chevron = advHeader.querySelector('.chevron');
advHeader.addEventListener('click', () => {
    advContent.classList.toggle('open');
    chevron.style.transform = advContent.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
});

const toast = document.createElement('div');
toast.style.cssText = `
    position: absolute; top: -40px; left: 50%; transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.9); border: 1px solid #f0f0f0; color: #888;
    font-size: 12px; font-weight: 500; padding: 6px 16px; border-radius: 20px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.05); pointer-events: none;
    transition: top 0.6s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.6s ease;
    opacity: 0; z-index: 10000;
`;
dropZone.appendChild(toast);

let toastTimeout;
function showToast(message) {
    toast.textContent = message;
    toast.style.top = '10px'; toast.style.opacity = '1';
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.top = '-40px'; toast.style.opacity = '0';
    }, 2500);
}

fillColorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
        fillColorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFillColor = btn.getAttribute('data-color') || 'none';
        applyStylesToSVG();
        generateSeed();
    });
});

bgColorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
        bgColorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentBgColor = btn.getAttribute('data-bg') || 'transparent';
        editor.style.backgroundColor = currentBgColor === 'transparent' ? '#f5f5f5' : currentBgColor;
        applyStylesToSVG();
        updateHamburgerColor();
    });
});

renderModeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentRenderMode = e.target.value;
        applyStylesToSVG();
        generateSeed();
    });
});

async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
                delegate: "GPU"
            },
            runningMode: "IMAGE",
            outputConfidenceMasks: true
        });
        loadingOverlay.classList.add('hidden');
    } catch (error) {
        loadingText.textContent = "Error loading AI"; loadingText.style.color = "red";
    }
}
initAI();

function setupDblClickInput(displayEl, sliderEl, min, max) {
    if (!displayEl) return;
    displayEl.style.cursor = 'pointer';
    displayEl.title = 'Double click to edit';
    
    displayEl.addEventListener('dblclick', () => {
        if (displayEl.querySelector('input')) return;
        const currentVal = sliderEl.value;
        const input = document.createElement('input');
        input.type = 'number'; input.min = min; input.max = max; input.value = currentVal; input.className = 'inline-input';
        displayEl.textContent = ''; displayEl.appendChild(input); input.focus(); input.select();

        const commit = () => {
            let num = parseFloat(input.value);
            if (!isNaN(num)) {
                num = Math.min(max, Math.max(min, num));
                sliderEl.value = num; displayEl.textContent = num;
                sliderEl.dispatchEvent(new Event('change')); 
            } else { displayEl.textContent = currentVal; }
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') displayEl.textContent = currentVal; });
    });
}
setupDblClickInput(qualityValueDisplay, qualitySlider, 1, 5);
setupDblClickInput(thresholdValueDisplay, thresholdSlider, 1, 99);
setupDblClickInput(resValueDisplay, resolutionSlider, 2, 500);
setupDblClickInput(offsetValueDisplay, offsetSlider, -100, 100);
setupDblClickInput(widthValueDisplay, strokeWidthSlider, 0, 50);

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) processFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) processFile(e.target.files[0]);
});

qualitySlider.addEventListener('change', () => {
    qualityValueDisplay.textContent = qualitySlider.value;
    if (currentRawFile) processFile(currentRawFile);
    generateSeed();
});

async function compressImage(blob, maxSizeKB = 500, maxDimension = 1600) {
    return new Promise((resolve, reject) => {
        const img = new Image(); const url = URL.createObjectURL(blob); img.src = url;
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            let width = img.width; let height = img.height;
            if (width > maxDimension || height > maxDimension) {
                if (width > height) { height = Math.round((height * maxDimension) / width); width = maxDimension; }
                else { width = Math.round((width * maxDimension) / height); height = maxDimension; }
            }
            canvas.width = width; canvas.height = height;
            const ctxCanvas = canvas.getContext('2d'); ctxCanvas.drawImage(img, 0, 0, width, height);
            let quality = 0.9; let dataUrl = canvas.toDataURL('image/jpeg', quality);
            while ((dataUrl.length * (3 / 4)) > maxSizeKB * 1024 && quality > 0.15) {
                quality -= 0.1; dataUrl = canvas.toDataURL('image/jpeg', quality);
            }
            resolve(dataUrl);
        };
        img.onerror = reject;
    });
}

async function processFile(file) {
    if (!imageSegmenter) return;
    currentRawFile = file; 
    loadingText.textContent = "Compressing & Resizing..."; loadingOverlay.classList.remove('hidden');

    const qualitySettings = [{ kb: 100, px: 800 }, { kb: 250, px: 1200 }, { kb: 500, px: 1600 }, { kb: 1000, px: 2000 }, { kb: 2000, px: 2500 }];
    const settings = qualitySettings[parseInt(qualitySlider.value) - 1];

    try {
        let blob = file;
        if (file.name.toLowerCase().endsWith('.heic')) blob = await heic2any({ blob: file, toType: 'image/jpeg' });
        const compressedDataUrl = await compressImage(blob, settings.kb, settings.px);
        loadingText.textContent = "Processing AI...";
        originalImage.src = compressedDataUrl; originalPreview.src = compressedDataUrl; 
        originalImage.onload = () => extractPerson(); 
    } catch (error) {
        loadingOverlay.classList.add('hidden'); alert("Failed to process image.");
    }
}

function extractPerson() {
    const segmentationResult = imageSegmenter.segment(originalImage);
    const masks = segmentationResult.confidenceMasks;
    if (masks && masks.length > 0) {
        if (masks.length > 2) {
            const bgMask = masks[0].getAsFloat32Array();
            rawConfidenceMask = new Float32Array(bgMask.length);
            for (let i = 0; i < bgMask.length; i++) rawConfidenceMask[i] = 1.0 - bgMask[i];
            rawConfidenceMask.isPerson = true; 
        } else {
            rawConfidenceMask = masks[masks.length > 1 ? 1 : 0].getAsFloat32Array();
        }
    } else {
        alert("Failed to get mask data."); loadingOverlay.classList.add('hidden'); return;
    }
    aiMaskCanvas.width = originalImage.width; aiMaskCanvas.height = originalImage.height;
    [thresholdSlider, resolutionSlider, offsetSlider, downloadSvgBtn, downloadPngBtn].forEach(el => el.disabled = false);
    toggleBgCheckbox.disabled = false; loadingOverlay.classList.add('hidden');
    updateMaskAndGenerate(); showToast("Ready! Let's edit.");
}

function updateMaskAndGenerate() {
    if (!rawConfidenceMask) return;
    const width = originalImage.width; const height = originalImage.height;
    const maskCtx = aiMaskCanvas.getContext('2d'); const imageData = maskCtx.createImageData(width, height);
    const threshold = parseInt(thresholdSlider.value) / 100;
    let isBg = false;
    if (!rawConfidenceMask.isPerson) {
        isBg = (rawConfidenceMask[0] + rawConfidenceMask[width - 1] + rawConfidenceMask[(height - 1) * width] + rawConfidenceMask[height * width - 1]) > 2.0;
    }
    for (let i = 0; i < rawConfidenceMask.length; i++) {
        let conf = rawConfidenceMask[i]; if (isBg) conf = 1.0 - conf;
        const color = conf >= threshold ? 0 : 255; 
        imageData.data[i*4] = color; imageData.data[i*4+1] = color; imageData.data[i*4+2] = color; imageData.data[i*4+3] = 255;   
    }
    maskCtx.putImageData(imageData, 0, 0);
    generateSVG();
}

function fillMaskHoles(tCtx, width, height) {
    const imgData = tCtx.getImageData(0, 0, width, height); const data = imgData.data;
    const visited = new Uint8Array(width * height); const queue = [];
    for (let x = 0; x < width; x++) {
        if (data[(0 * width + x) * 4] === 255) { queue.push(x, 0); visited[0 * width + x] = 1; }
        if (data[((height - 1) * width + x) * 4] === 255) { queue.push(x, height - 1); visited[(height - 1) * width + x] = 1; }
    }
    for (let y = 0; y < height; y++) {
        if (data[(y * width + 0) * 4] === 255) { queue.push(0, y); visited[y * width + 0] = 1; }
        if (data[(y * width + (width - 1)) * 4] === 255) { queue.push(width - 1, y); visited[y * width + (width - 1)] = 1; }
    }
    let head = 0;
    while (head < queue.length) {
        const x = queue[head++]; const y = queue[head++];
        const neighbors = [[x+1, y], [x-1, y], [x, y+1], [x, y-1]];
        for (let i = 0; i < 4; i++) {
            const nx = neighbors[i][0]; const ny = neighbors[i][1];
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const idx = ny * width + nx;
                if (!visited[idx] && data[idx * 4] === 255) { visited[idx] = 1; queue.push(nx, ny); }
            }
        }
    }
    for (let i = 0; i < width * height; i++) {
        if (!visited[i] && data[i * 4] === 255) { data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; }
    }
    tCtx.putImageData(imgData, 0, 0);
}

function getOffsetMask() {
    const offset = parseInt(offsetSlider.value);
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = aiMaskCanvas.width + (PADDING * 2); tempCanvas.height = aiMaskCanvas.height + (PADDING * 2);
    const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tCtx.fillStyle = 'white'; tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tCtx.filter = `blur(${Math.abs(offset)}px)`; tCtx.drawImage(aiMaskCanvas, PADDING, PADDING);
    const imgData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const threshold = offset > 0 ? 245 : 10; 
    for (let i = 0; i < imgData.data.length; i += 4) {
        const color = imgData.data[i] < threshold ? 0 : 255;
        imgData.data[i] = color; imgData.data[i+1] = color; imgData.data[i+2] = color; imgData.data[i+3] = 255;
    }
    tCtx.putImageData(imgData, 0, 0);
    if (fillHolesToggle.checked) fillMaskHoles(tCtx, tempCanvas.width, tempCanvas.height);
    return tempCanvas;
}

function generateSVG() {
    const scale = resolutionSlider.value / 1000;
    const processedMask = getOffsetMask();
    hiddenCanvas.width = processedMask.width * scale; hiddenCanvas.height = processedMask.height * scale;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, hiddenCanvas.width, hiddenCanvas.height);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(processedMask, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    const tracerOptions = {
        ltres: 1, qtres: 10, pathomit: 8, linefilter: true, viewbox: true,
        pal: [{r:0,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}], colorquantcycles: 1
    };

    svgContainer.innerHTML = ImageTracer.imagedataToSVG(
        ctx.getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height), tracerOptions
    );
    cleanUpSVG(); applyStylesToSVG();
}

let isUpdating = false;
function rafThrottle(func) {
    return function(...args) {
        if (!isUpdating) { isUpdating = true; requestAnimationFrame(() => { func.apply(this, args); isUpdating = false; }); }
    }
}

thresholdSlider.addEventListener('input', (e) => { thresholdValueDisplay.textContent = e.target.value; rafThrottle(() => { updateMaskAndGenerate(); generateSeed(); })(); });
resolutionSlider.addEventListener('input', (e) => { resValueDisplay.textContent = e.target.value; rafThrottle(() => { generateSVG(); generateSeed(); })(); });
offsetSlider.addEventListener('input', (e) => { offsetValueDisplay.textContent = e.target.value; rafThrottle(() => { generateSVG(); generateSeed(); })(); });
strokeWidthSlider.addEventListener('input', (e) => { widthValueDisplay.textContent = e.target.value; applyStylesToSVG(); generateSeed(); });
strokeLinejoinSelect.addEventListener('change', () => { applyStylesToSVG(); generateSeed(); });
fillHolesToggle.addEventListener('change', () => { generateSVG(); generateSeed(); });
toggleBgCheckbox.addEventListener('change', (e) => { originalPreview.classList.toggle('hidden', !e.target.checked); });

function cleanUpSVG() {
    const svg = svgContainer.querySelector('svg');
    if(!svg) return;
    
    const scale = resolutionSlider.value / 1000;
    const scaledPadding = PADDING * scale;
    const fullWidth = hiddenCanvas.width;
    const fullHeight = hiddenCanvas.height;
    
    const paths = Array.from(svg.querySelectorAll('path'));
    paths.forEach(path => {
        const fillAttr = (path.getAttribute('fill') || '').toLowerCase();
        const isWhite = fillAttr.includes('255,255,255') || fillAttr.includes('#fff');
        try {
            const bbox = path.getBBox();
            if (isWhite && (bbox.width >= fullWidth * 0.95 && bbox.height >= fullHeight * 0.95)) {
                path.remove();
            } else if (isWhite) { path.setAttribute('data-type', 'hole'); } 
            else { path.setAttribute('data-type', 'person'); }
        } catch(e) { path.setAttribute('data-type', 'person'); }
    });

    const personPaths = Array.from(svg.querySelectorAll('path[data-type="person"]'));
    
    let maxArea = 0;
    personPaths.forEach(path => {
        try {
            const bbox = path.getBBox();
            const area = bbox.width * bbox.height;
            if (area > maxArea) maxArea = area;
        } catch(e) {}
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    personPaths.forEach(path => {
        try {
            const bbox = path.getBBox();
            const area = bbox.width * bbox.height;
            
            if (area < maxArea * 0.1) {
                path.remove();
            } else {
                if (bbox.width > 0 && bbox.height > 0) {
                    minX = Math.min(minX, bbox.x); minY = Math.min(minY, bbox.y);
                    maxX = Math.max(maxX, bbox.x + bbox.width); maxY = Math.max(maxY, bbox.y + bbox.height);
                }
            }
        } catch(e) {}
    });

    if (minX === Infinity) { 
        minX = scaledPadding; minY = scaledPadding; 
        maxX = scaledPadding + aiMaskCanvas.width * scale; maxY = scaledPadding + aiMaskCanvas.height * scale; 
    }

    const targetPadding = 150 * scale; 
    const finalMinX = Math.max(0, minX - targetPadding);
    const finalMinY = Math.max(0, minY - targetPadding);
    const finalMaxX = Math.min(fullWidth, maxX + targetPadding);
    const finalMaxY = Math.min(fullHeight, maxY + targetPadding);
    
    const finalWidth = finalMaxX - finalMinX;
    const finalHeight = finalMaxY - finalMinY;

    svg.setAttribute('viewBox', `${finalMinX} ${finalMinY} ${finalWidth} ${finalHeight}`);
    svg.dataset.exportWidth = finalWidth / scale; 
    svg.dataset.exportHeight = finalHeight / scale;
}

function applyStylesToSVG() {
    const svg = svgContainer.querySelector('svg');
    if(!svg) return;
    
    // 【修正箇所】解像度スケールを取得し、strokeWidthSliderの値に掛け合わせることで見た目の太さを均一化
    const scale = resolutionSlider.value / 1000;
    const width = strokeWidthSlider.value * scale; 
    
    const join = strokeLinejoinSelect.value;
    const strokeColor = currentFillColor === 'none' ? '#000000' : currentFillColor;
    
    let bgRect = svg.querySelector('rect.bg-rect');
    if (currentBgColor !== 'transparent') {
        if (!bgRect) {
            bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bgRect.setAttribute('class', 'bg-rect');
            svg.insertBefore(bgRect, svg.firstChild); 
        }
        bgRect.setAttribute('fill', currentBgColor);
        if (svg.viewBox && svg.viewBox.baseVal) {
            bgRect.setAttribute('x', svg.viewBox.baseVal.x);
            bgRect.setAttribute('y', svg.viewBox.baseVal.y);
            bgRect.setAttribute('width', svg.viewBox.baseVal.width);
            bgRect.setAttribute('height', svg.viewBox.baseVal.height);
        }
    } else if (bgRect) {
        bgRect.remove();
    }
    
    svg.querySelectorAll('path[data-type="person"]').forEach(path => {
        path.setAttribute('fill', currentRenderMode === 'fill' ? currentFillColor : 'none');
        path.setAttribute('stroke', strokeColor); path.setAttribute('stroke-width', width); path.setAttribute('stroke-linejoin', join);
    });

    svg.querySelectorAll('path[data-type="hole"]').forEach(path => {
        path.setAttribute('fill', (currentRenderMode === 'fill' && currentFillColor !== 'none') ? '#ffffff' : 'none');
        path.setAttribute('stroke', (currentRenderMode === 'fill' && currentFillColor !== 'none') ? 'none' : strokeColor);
        if(currentRenderMode !== 'fill' || currentFillColor === 'none') {
            path.setAttribute('stroke-width', width); path.setAttribute('stroke-linejoin', join);
        }
    });
}

function getFormattedFileName() {
    const now = new Date();
    const d = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')];
    const t = [String(now.getHours()).padStart(2,'0'), String(now.getMinutes()).padStart(2,'0'), String(now.getSeconds()).padStart(2,'0')];
    return `Silhouette ${d.join('-')} at ${t.join('.')}`;
}

downloadSvgBtn.addEventListener('click', async () => {
    const svg = svgContainer.querySelector('svg'); if (!svg) return;
    const serializer = new XMLSerializer(); let svgString = serializer.serializeToString(svg);
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    triggerDownload(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }), `${getFormattedFileName()}.svg`);
});

downloadPngBtn.addEventListener('click', () => {
    const svg = svgContainer.querySelector('svg'); if (!svg) return;
    
    const expWidth = parseFloat(svg.dataset.exportWidth) || originalImage.width;
    const expHeight = parseFloat(svg.dataset.exportHeight) || originalImage.height;

    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute('width', expWidth);
    clonedSvg.setAttribute('height', expHeight);

    const serializer = new XMLSerializer(); let svgString = serializer.serializeToString(clonedSvg);
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');

    const canvas = document.createElement('canvas'); canvas.width = expWidth; canvas.height = expHeight;
    const ctxCanvas = canvas.getContext('2d');
    const img = new Image(); const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));

    img.onload = () => {
        ctxCanvas.drawImage(img, 0, 0); URL.revokeObjectURL(url);
        canvas.toBlob((blob) => triggerDownload(blob, `${getFormattedFileName()}.png`), 'image/png');
    };
    img.src = url;
});

async function triggerDownload(blob, defaultFileName) {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName: defaultFileName });
            const writable = await handle.createWritable(); await writable.write(blob); await writable.close();
        } catch (e) { console.log("Save cancelled"); }
    } else {
        const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = defaultFileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }
}

function getActiveColorIndex(btns) {
    let idx = 0; btns.forEach((btn, i) => { if (btn.classList.contains('active')) idx = i; }); return idx;
}

function generateSeed() {
    const t = parseInt(thresholdSlider.value).toString(16).padStart(2, '0');
    const r = parseInt(resolutionSlider.value).toString(16).padStart(3, '0');
    const o = (parseInt(offsetSlider.value) + 100).toString(16).padStart(2, '0');
    const w = parseInt(strokeWidthSlider.value).toString(16).padStart(2, '0');
    const j = Math.max(0, ['round', 'miter', 'bevel'].indexOf(strokeLinejoinSelect.value)).toString(16);
    const h = fillHolesToggle.checked ? '1' : '0';
    const c = getActiveColorIndex(fillColorBtns).toString(16); 
    const m = currentRenderMode === 'fill' ? '1' : '0';
    const q = qualitySlider.value;
    const seed = `#${t}${r}${o}${w}${j}${h}${c}${m}${q}`.toUpperCase();
    currentSeedDisplay.textContent = seed; return seed;
}

function loadSeed(seed) {
    if (!seed) return; const cleanSeed = seed.trim().replace(/^#/, '');
    if (cleanSeed.length !== 12 && cleanSeed.length !== 14) { alert(`無効なシード値フォーマットです`); return; }
    try {
        const [t, r, o, w, jIdx, h, cIdx] = [
            parseInt(cleanSeed.substring(0,2),16), parseInt(cleanSeed.substring(2,5),16), parseInt(cleanSeed.substring(5,7),16)-100,
            parseInt(cleanSeed.substring(7,9),16), parseInt(cleanSeed.substring(9,10),16), cleanSeed.substring(10,11)==='1', parseInt(cleanSeed.substring(11,12),16)
        ];
        let m = cleanSeed.length === 14 ? cleanSeed.substring(12,13) : '1';
        let q = cleanSeed.length === 14 ? cleanSeed.substring(13,14) : '3';

        thresholdSlider.value = t; thresholdValueDisplay.textContent = t;
        resolutionSlider.value = r; resValueDisplay.textContent = r;
        offsetSlider.value = o; offsetValueDisplay.textContent = o;
        strokeWidthSlider.value = w; widthValueDisplay.textContent = w;
        if (['round', 'miter', 'bevel'][jIdx]) strokeLinejoinSelect.value = ['round', 'miter', 'bevel'][jIdx];
        fillHolesToggle.checked = h;
        if (fillColorBtns[cIdx]) {
            fillColorBtns.forEach(b => b.classList.remove('active')); fillColorBtns[cIdx].classList.add('active');
            currentFillColor = fillColorBtns[cIdx].getAttribute('data-color') || 'none';
        }
        currentRenderMode = m === '1' ? 'fill' : 'stroke';
        const targetRadio = document.querySelector(`input[name="render-mode"][value="${currentRenderMode}"]`); if (targetRadio) targetRadio.checked = true;
        qualitySlider.value = q; qualityValueDisplay.textContent = q;

        generateSeed();
        if (rawConfidenceMask) updateMaskAndGenerate(); else applyStylesToSVG();
        showToast("Loaded successfully.");
    } catch (e) { alert("シード値の読み込みに失敗しました。"); }
}

loadSeedBtn.addEventListener('click', () => { if (seedInput.value) loadSeed(seedInput.value); });
seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && seedInput.value) loadSeed(seedInput.value); });
copySeedBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentSeedDisplay.textContent).then(() => {
        const originalColor = copySeedBtn.querySelector('svg').style.stroke;
        copySeedBtn.querySelector('svg').style.stroke = "#4caf50";
        setTimeout(() => copySeedBtn.querySelector('svg').style.stroke = originalColor, 1000);
        showToast("Copied to clipboard.");
    });
});

generateSeed();