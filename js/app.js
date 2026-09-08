import { ImageSegmenter, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm";

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const svgContainer = document.getElementById('svg-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const originalPreview = document.getElementById('original-preview');
const toggleBgBtn = document.getElementById('toggle-bg-btn');

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
const downloadSvgBtn = document.getElementById('download-svg-btn');
const downloadPngBtn = document.getElementById('download-png-btn');

const seedInput = document.getElementById('seed-input');
const loadSeedBtn = document.getElementById('load-seed-btn');
const currentSeedDisplay = document.getElementById('current-seed-display');
const copySeedBtn = document.getElementById('copy-seed-btn');

const colorBtns = document.querySelectorAll('.color-btn');
let currentFillColor = 'none';

const hiddenCanvas = document.getElementById('hidden-canvas');
const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

let imageSegmenter;
let originalImage = new Image();
let aiMaskCanvas = document.createElement('canvas');
let rawConfidenceMask = null;

const PADDING = 150;

// --- メニュー開閉ロジック（初期状態で開く） ---
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const editor = document.getElementById('editor');

menuBtn.classList.add('open');
sidebar.classList.add('open');
editor.classList.add('shifted');

menuBtn.addEventListener('click', () => {
    menuBtn.classList.toggle('open');
    sidebar.classList.toggle('open');
    editor.classList.toggle('shifted');
});

// --- トースト通知（ポップアップメッセージ）の動的生成 ---
dropZone.style.position = 'relative';

const toast = document.createElement('div');
toast.style.cssText = `
    position: absolute;
    top: -40px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(255, 255, 255, 0.9);
    border: 1px solid #f0f0f0;
    color: #888;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 16px;
    border-radius: 20px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.05);
    pointer-events: none;
    transition: top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.4s ease;
    opacity: 0;
    z-index: 10000;
`;
dropZone.appendChild(toast);

let toastTimeout;
function showToast(message) {
    toast.textContent = message;
    toast.style.top = '10px';
    toast.style.opacity = '1';
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.top = '-40px';
        toast.style.opacity = '0';
    }, 2500);
}

// --- カラーパレットロジック ---
colorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
        colorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFillColor = btn.getAttribute('data-color') || 'none';
        applyStylesToSVG();
        generateSeed();
    });
});

async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
                delegate: "GPU"
            },
            runningMode: "IMAGE",
            outputConfidenceMasks: true
        });
        loadingOverlay.classList.add('hidden');
    } catch (error) {
        console.error(error);
        loadingText.textContent = "Error loading AI model";
        loadingText.style.color = "red";
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
        input.type = 'number';
        input.min = min;
        input.max = max;
        input.value = currentVal;
        input.className = 'inline-input';

        displayEl.textContent = '';
        displayEl.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            let num = parseFloat(input.value);
            if (!isNaN(num)) {
                num = Math.min(max, Math.max(min, num));
                sliderEl.value = num;
                displayEl.textContent = num;
                sliderEl.dispatchEvent(new Event('input'));
            } else {
                displayEl.textContent = currentVal;
            }
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                displayEl.textContent = currentVal;
            }
        });
    });
}

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

// --- 画像軽量化・リサイズ処理 ---
async function compressImage(blob, maxSizeKB = 500, maxDimension = 1600) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.src = url;

        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctxCanvas = canvas.getContext('2d');
            ctxCanvas.drawImage(img, 0, 0, width, height);

            let quality = 0.9;
            let dataUrl = canvas.toDataURL('image/jpeg', quality);

            while ((dataUrl.length * (3 / 4)) > maxSizeKB * 1024 && quality > 0.15) {
                quality -= 0.1;
                dataUrl = canvas.toDataURL('image/jpeg', quality);
            }

            resolve(dataUrl);
        };

        img.onerror = (err) => reject(err);
    });
}

async function processFile(file) {
    if (!imageSegmenter) return;
    loadingText.textContent = "Compressing & Resizing...";
    loadingOverlay.classList.remove('hidden');

    try {
        let blob = file;
        if (file.name.toLowerCase().endsWith('.heic')) {
            blob = await heic2any({ blob: file, toType: 'image/jpeg' });
        }

        const compressedDataUrl = await compressImage(blob, 500, 1600);

        loadingText.textContent = "Processing AI...";
        originalImage.src = compressedDataUrl;
        originalPreview.src = compressedDataUrl; 

        originalImage.onload = () => extractPerson(); 
    } catch (error) {
        console.error(error);
        loadingOverlay.classList.add('hidden');
        alert("Failed to process image.");
    }
}

function extractPerson() {
    const segmentationResult = imageSegmenter.segment(originalImage);
    const masks = segmentationResult.confidenceMasks;
    if (masks && masks.length > 0) {
        const maskIndex = masks.length > 1 ? 1 : 0;
        rawConfidenceMask = masks[maskIndex].getAsFloat32Array();
    } else {
        alert("Failed to get mask data from AI.");
        loadingOverlay.classList.add('hidden');
        return;
    }
    
    aiMaskCanvas.width = originalImage.width;
    aiMaskCanvas.height = originalImage.height;

    [thresholdSlider, resolutionSlider, offsetSlider, toggleBgBtn, downloadSvgBtn, downloadPngBtn].forEach(el => el.disabled = false);
    loadingOverlay.classList.add('hidden');
    
    updateMaskAndGenerate();
}

function updateMaskAndGenerate() {
    if (!rawConfidenceMask) return;

    const width = originalImage.width;
    const height = originalImage.height;
    const maskCtx = aiMaskCanvas.getContext('2d');
    const imageData = maskCtx.createImageData(width, height);
    const threshold = parseInt(thresholdSlider.value) / 100;

    const cornersSum = rawConfidenceMask[0] + rawConfidenceMask[width - 1] + 
                       rawConfidenceMask[(height - 1) * width] + rawConfidenceMask[height * width - 1];
    const isBackgroundMask = cornersSum > 2.0;

    for (let i = 0; i < rawConfidenceMask.length; i++) {
        let confidence = rawConfidenceMask[i];
        if (isBackgroundMask) confidence = 1.0 - confidence;
        const color = confidence >= threshold ? 0 : 255; 
        imageData.data[i * 4] = color;     
        imageData.data[i * 4 + 1] = color; 
        imageData.data[i * 4 + 2] = color; 
        imageData.data[i * 4 + 3] = 255;   
    }
    maskCtx.putImageData(imageData, 0, 0);

    generateSVG();
}

function fillMaskHoles(tCtx, width, height) {
    const imgData = tCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const visited = new Uint8Array(width * height);
    const queue = [];

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
        const x = queue[head++];
        const y = queue[head++];

        const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
        for (let i = 0; i < 4; i++) {
            const nx = neighbors[i][0];
            const ny = neighbors[i][1];
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const idx = ny * width + nx;
                if (!visited[idx] && data[idx * 4] === 255) {
                    visited[idx] = 1;
                    queue.push(nx, ny);
                }
            }
        }
    }

    for (let i = 0; i < width * height; i++) {
        if (!visited[i] && data[i * 4] === 255) {
            data[i * 4] = 0;
            data[i * 4 + 1] = 0;
            data[i * 4 + 2] = 0;
        }
    }

    tCtx.putImageData(imgData, 0, 0);
}

function getOffsetMask() {
    const offset = parseInt(offsetSlider.value);
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = aiMaskCanvas.width + (PADDING * 2);
    tempCanvas.height = aiMaskCanvas.height + (PADDING * 2);
    const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

    tCtx.fillStyle = 'white';
    tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    
    tCtx.filter = `blur(${Math.abs(offset)}px)`;
    tCtx.drawImage(aiMaskCanvas, PADDING, PADDING);

    const imgData = tCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imgData.data;
    const threshold = offset > 0 ? 245 : 10; 

    for (let i = 0; i < data.length; i += 4) {
        const color = data[i] < threshold ? 0 : 255;
        data[i] = color;
        data[i + 1] = color;
        data[i + 2] = color;
        data[i + 3] = 255;
    }
    tCtx.putImageData(imgData, 0, 0);

    if (fillHolesToggle.checked) {
        fillMaskHoles(tCtx, tempCanvas.width, tempCanvas.height);
    }

    return tempCanvas;
}

function generateSVG() {
    const scale = resolutionSlider.value / 1000;
    const processedMask = getOffsetMask();

    hiddenCanvas.width = processedMask.width * scale;
    hiddenCanvas.height = processedMask.height * scale;
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, hiddenCanvas.width, hiddenCanvas.height);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(processedMask, 0, 0, hiddenCanvas.width, hiddenCanvas.height);

    const tracerOptions = {
        ltres: 1, qtres: 10, pathomit: 8, linefilter: true, viewbox: true,
        pal: [{r:0,g:0,b:0,a:255}, {r:255,g:255,b:255,a:255}],
        colorquantcycles: 1
    };

    svgContainer.innerHTML = ImageTracer.imagedataToSVG(
        ctx.getImageData(0, 0, hiddenCanvas.width, hiddenCanvas.height), 
        tracerOptions
    );

    cleanUpSVG();
    applyStylesToSVG();
}

thresholdSlider.addEventListener('input', (e) => {
    thresholdValueDisplay.textContent = e.target.value;
    updateMaskAndGenerate();
    generateSeed();
});
resolutionSlider.addEventListener('input', (e) => {
    resValueDisplay.textContent = e.target.value;
    generateSVG();
    generateSeed();
});
offsetSlider.addEventListener('input', (e) => {
    offsetValueDisplay.textContent = e.target.value;
    generateSVG(); 
    generateSeed();
});
strokeWidthSlider.addEventListener('input', (e) => {
    widthValueDisplay.textContent = e.target.value;
    applyStylesToSVG();
    generateSeed();
});
strokeLinejoinSelect.addEventListener('change', () => {
    applyStylesToSVG();
    generateSeed();
});
fillHolesToggle.addEventListener('change', () => {
    generateSVG();
    generateSeed();
});

toggleBgBtn.addEventListener('click', () => {
    originalPreview.classList.toggle('hidden');
});

function cleanUpSVG() {
    const svg = svgContainer.querySelector('svg');
    if(!svg) return;
    
    const scale = resolutionSlider.value / 1000;
    const scaledPadding = PADDING * scale;
    const originalWidth = aiMaskCanvas.width * scale;
    const originalHeight = aiMaskCanvas.height * scale;
    
    svg.setAttribute('viewBox', `${scaledPadding} ${scaledPadding} ${originalWidth} ${originalHeight}`);
    
    const fullWidth = hiddenCanvas.width;
    const fullHeight = hiddenCanvas.height;
    const paths = Array.from(svg.querySelectorAll('path'));
    
    paths.forEach(path => {
        const fillAttr = (path.getAttribute('fill') || '').toLowerCase();
        const isWhite = fillAttr.includes('255,255,255') || fillAttr.includes('#fff') || fillAttr.includes('#ffffff');
        
        try {
            const bbox = path.getBBox();
            const isOuterBackground = isWhite && (bbox.width >= fullWidth * 0.95 && bbox.height >= fullHeight * 0.95);

            if (isOuterBackground) {
                path.remove();
            } else if (isWhite) {
                path.setAttribute('data-type', 'hole');
            } else {
                path.setAttribute('data-type', 'person');
            }
        } catch(e) {
            path.setAttribute('data-type', 'person');
        }
    });

    const personPaths = Array.from(svg.querySelectorAll('path[data-type="person"]'));
    personPaths.forEach(path => {
        fixBottomOnlyPath(path, scaledPadding, scaledPadding + originalWidth, scaledPadding, scaledPadding + originalHeight);
    });
}

function fixBottomOnlyPath(path, minX, maxX, minY, maxY) {
    const d = path.getAttribute('d');
    if (!d) return;

    const matches = d.match(/-?\d+(\.\d+)?/g);
    if (!matches || matches.length < 4) return;

    const points = [];
    for (let i = 0; i < matches.length; i += 2) {
        points.push([parseFloat(matches[i]), parseFloat(matches[i+1])]);
    }

    const margin = 8;
    const bottomY = maxY - margin;

    const validPoints = points.filter(([x, y]) => {
        const isTop = (y <= minY + margin);
        const isLeft = (x <= minX + margin);
        const isRight = (x >= maxX - margin);
        return !(isTop || isLeft || isRight);
    });

    if (validPoints.length < 3) {
        path.remove();
        return;
    }

    const bottomPoints = validPoints.filter(([x, y]) => y >= bottomY);

    if (bottomPoints.length >= 2) {
        const minBottomX = Math.min(...bottomPoints.map(p => p[0]));
        const maxBottomX = Math.max(...bottomPoints.map(p => p[0]));

        const finalPoints = validPoints.map(([x, y]) => {
            if (y >= bottomY) {
                return [Math.max(minBottomX, Math.min(maxBottomX, x)), maxY];
            }
            return [x, y];
        });

        const newD = "M " + finalPoints.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") + " Z";
        path.setAttribute('d', newD);
    } else {
        const newD = "M " + validPoints.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L ") + " Z";
        path.setAttribute('d', newD);
    }
}

function applyStylesToSVG() {
    const svg = svgContainer.querySelector('svg');
    if(!svg) return;
    
    const width = strokeWidthSlider.value;
    const join = strokeLinejoinSelect.value;
    const strokeColor = currentFillColor === 'none' ? '#000000' : currentFillColor;
    
    const personPaths = svg.querySelectorAll('path[data-type="person"]');
    const holePaths = svg.querySelectorAll('path[data-type="hole"]');
    
    personPaths.forEach(path => {
        path.setAttribute('fill', currentFillColor);
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('stroke-width', width);
        path.setAttribute('stroke-linejoin', join);
    });

    holePaths.forEach(path => {
        if (currentFillColor !== 'none') {
            path.setAttribute('fill', '#ffffff');
            path.setAttribute('stroke', 'none');
        } else {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#000000');
            path.setAttribute('stroke-width', width);
            path.setAttribute('stroke-linejoin', join);
        }
    });
}

function getFormattedFileName() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `Silhouette ${yyyy}-${mm}-${dd} at ${hh}.${min}.${ss}`;
}

downloadSvgBtn.addEventListener('click', async () => {
    const svg = svgContainer.querySelector('svg');
    if (!svg) return;

    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svg);
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const fileName = `${getFormattedFileName()}.svg`;

    triggerDownload(blob, fileName);
});

downloadPngBtn.addEventListener('click', () => {
    const svg = svgContainer.querySelector('svg');
    if (!svg) return;

    const clonedSvg = svg.cloneNode(true);
    clonedSvg.setAttribute('width', originalImage.width);
    clonedSvg.setAttribute('height', originalImage.height);

    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(clonedSvg);
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }

    const canvas = document.createElement('canvas');
    canvas.width = originalImage.width;
    canvas.height = originalImage.height;
    const ctxCanvas = canvas.getContext('2d');

    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
        ctxCanvas.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        
        canvas.toBlob((blob) => {
            const fileName = `${getFormattedFileName()}.png`;
            triggerDownload(blob, fileName);
        }, 'image/png');
    };
    img.src = url;
});

async function triggerDownload(blob, defaultFileName) {
    try {
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: defaultFileName,
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = defaultFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    } catch (error) {
        console.log("Save cancelled:", error);
    }
}

// --- シード値関連ロジック ---
function getActiveColorIndex() {
    let activeIdx = 0;
    colorBtns.forEach((btn, index) => {
        if (btn.classList.contains('active')) {
            activeIdx = index;
        }
    });
    return activeIdx;
}

function generateSeed() {
    const t = parseInt(thresholdSlider.value).toString(16).padStart(2, '0');
    const r = parseInt(resolutionSlider.value).toString(16).padStart(3, '0');
    const o = (parseInt(offsetSlider.value) + 100).toString(16).padStart(2, '0');
    const w = parseInt(strokeWidthSlider.value).toString(16).padStart(2, '0');
    const joins = ['round', 'miter', 'bevel'];
    const j = Math.max(0, joins.indexOf(strokeLinejoinSelect.value)).toString(16);
    const h = fillHolesToggle.checked ? '1' : '0';
    const c = getActiveColorIndex().toString(16);

    const seed = `#${t}${r}${o}${w}${j}${h}${c}`.toUpperCase();
    currentSeedDisplay.textContent = seed;
    return seed;
}

function loadSeed(seed) {
    if (!seed) return;
    const cleanSeed = seed.trim().replace(/^#/, '');

    if (cleanSeed.length !== 12) {
        alert(`無効なシード値フォーマットです（12桁の文字が必要です: 現在${cleanSeed.length}桁）`);
        return;
    }

    try {
        const t = parseInt(cleanSeed.substring(0, 2), 16);
        const r = parseInt(cleanSeed.substring(2, 5), 16);
        const o = parseInt(cleanSeed.substring(5, 7), 16) - 100;
        const w = parseInt(cleanSeed.substring(7, 9), 16);
        const jIdx = parseInt(cleanSeed.substring(9, 10), 16);
        const h = cleanSeed.substring(10, 11) === '1';
        const cIdx = parseInt(cleanSeed.substring(11, 12), 16);

        if (isNaN(t) || isNaN(r) || isNaN(o) || isNaN(w) || isNaN(jIdx) || isNaN(cIdx)) {
            throw new Error("Invalid number parsing");
        }

        thresholdSlider.value = t;
        thresholdValueDisplay.textContent = t;

        resolutionSlider.value = r;
        resValueDisplay.textContent = r;

        offsetSlider.value = o;
        offsetValueDisplay.textContent = o;

        strokeWidthSlider.value = w;
        widthValueDisplay.textContent = w;

        const joins = ['round', 'miter', 'bevel'];
        if (joins[jIdx]) strokeLinejoinSelect.value = joins[jIdx];

        fillHolesToggle.checked = h;

        if (colorBtns[cIdx]) {
            colorBtns.forEach(b => b.classList.remove('active'));
            colorBtns[cIdx].classList.add('active');
            currentFillColor = colorBtns[cIdx].getAttribute('data-color') || 'none';
        }

        generateSeed();

        if (rawConfidenceMask) {
            updateMaskAndGenerate();
        } else {
            applyStylesToSVG();
        }
        
        showToast("Loaded successfully.");
        
    } catch (e) {
        console.error("Seed parse error:", e);
        alert("シード値の読み込みに失敗しました。値が正しいか確認してください。");
    }
}

loadSeedBtn.addEventListener('click', () => {
    if (seedInput.value) loadSeed(seedInput.value);
});

seedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && seedInput.value) {
        loadSeed(seedInput.value);
    }
});

copySeedBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentSeedDisplay.textContent).then(() => {
        const originalColor = copySeedBtn.querySelector('svg').style.stroke;
        copySeedBtn.querySelector('svg').style.stroke = "#4caf50";
        setTimeout(() => copySeedBtn.querySelector('svg').style.stroke = originalColor, 1000);
        
        showToast("Copied to clipboard.");
    });
});

generateSeed();