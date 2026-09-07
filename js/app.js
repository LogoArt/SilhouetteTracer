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
const fillToggle = document.getElementById('fill-toggle');
const downloadBtn = document.getElementById('download-btn');

const hiddenCanvas = document.getElementById('hidden-canvas');
const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

let imageSegmenter;
let originalImage = new Image();
let aiMaskCanvas = document.createElement('canvas');
let rawConfidenceMask = null; // AIの生の検出確率データを保持

const PADDING = 150; // 余白

async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        imageSegmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
                delegate: "GPU"
            },
            runningMode: "IMAGE",
            outputConfidenceMasks: true // 高精度な確信度マスクを出力
        });
        loadingOverlay.classList.add('hidden');
    } catch (error) {
        console.error(error);
        loadingText.textContent = "AIの読み込みに失敗しました。";
        loadingText.style.color = "red";
    }
}
initAI();

// --- ダブルクリックで直入力できる機能 ---
function setupDblClickInput(displayEl, sliderEl, min, max) {
    if (!displayEl) return;
    displayEl.style.cursor = 'pointer';
    displayEl.title = 'ダブルクリックで直接数値入力';
    displayEl.addEventListener('dblclick', () => {
        const currentVal = sliderEl.value;
        const inputVal = prompt(`新しい値を入力してください (${min} ～ ${max}):`, currentVal);
        if (inputVal !== null) {
            let num = parseFloat(inputVal);
            if (!isNaN(num)) {
                num = Math.min(max, Math.max(min, num));
                sliderEl.value = num;
                displayEl.textContent = num;
                sliderEl.dispatchEvent(new Event('input'));
            }
        }
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

async function processFile(file) {
    if (!imageSegmenter) return;
    loadingText.textContent = "画像を解析中...";
    loadingOverlay.classList.remove('hidden');

    try {
        let imageURL = file.name.toLowerCase().endsWith('.heic') 
            ? URL.createObjectURL(await heic2any({ blob: file, toType: 'image/jpeg' }))
            : URL.createObjectURL(file);

        originalImage.src = imageURL;
        originalPreview.src = imageURL; 

        originalImage.onload = () => extractPerson(); 
    } catch (error) {
        loadingOverlay.classList.add('hidden');
        alert("画像の読み込みに失敗しました。");
    }
}

function extractPerson() {
    const segmentationResult = imageSegmenter.segment(originalImage);
    
    // マスク配列の長さを確認し、存在するインデックス（1つなら0、複数なら1）を安全に取得
    const masks = segmentationResult.confidenceMasks;
    if (masks && masks.length > 0) {
        const maskIndex = masks.length > 1 ? 1 : 0;
        rawConfidenceMask = masks[maskIndex].getAsFloat32Array();
    } else {
        alert("AIからのマスクデータ取得に失敗しました。");
        loadingOverlay.classList.add('hidden');
        return;
    }
    
    aiMaskCanvas.width = originalImage.width;
    aiMaskCanvas.height = originalImage.height;

    [thresholdSlider, resolutionSlider, offsetSlider, toggleBgBtn, downloadBtn].forEach(el => el.disabled = false);
    loadingOverlay.classList.add('hidden');
    
    updateMaskAndGenerate();
}

// しきい値スライダーに応じてAIマスクを再生成
function updateMaskAndGenerate() {
    if (!rawConfidenceMask) return;

    const width = originalImage.width;
    const height = originalImage.height;
    const maskCtx = aiMaskCanvas.getContext('2d');
    const imageData = maskCtx.createImageData(width, height);
    
    // スライダーの値(1~99%)をしきい値(0.01~0.99)に変換
    const threshold = parseInt(thresholdSlider.value) / 100;

    // 取得したマスクが「人物」ではなく「背景」の確信度だった場合の自動反転処理
    // （画像の四隅の数値の合計が2.0より大きければ、そこは高確率で背景だと判定する）
    const cornersSum = rawConfidenceMask[0] + rawConfidenceMask[width - 1] + 
                       rawConfidenceMask[(height - 1) * width] + rawConfidenceMask[height * width - 1];
    const isBackgroundMask = cornersSum > 2.0;

    for (let i = 0; i < rawConfidenceMask.length; i++) {
        let confidence = rawConfidenceMask[i];
        
        // 背景マスクだった場合は、数値を反転させて「人物マスク」として扱う
        if (isBackgroundMask) {
            confidence = 1.0 - confidence;
        }

        // しきい値より大きければ「人物（黒=0）」、小さければ「背景（白=255）」
        const color = confidence >= threshold ? 0 : 255; 
        imageData.data[i * 4] = color;     
        imageData.data[i * 4 + 1] = color; 
        imageData.data[i * 4 + 2] = color; 
        imageData.data[i * 4 + 3] = 255;   
    }
    maskCtx.putImageData(imageData, 0, 0);

    generateSVG();
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
});
resolutionSlider.addEventListener('input', (e) => {
    resValueDisplay.textContent = e.target.value;
    generateSVG();
});
offsetSlider.addEventListener('input', (e) => {
    offsetValueDisplay.textContent = e.target.value;
    generateSVG(); 
});
strokeWidthSlider.addEventListener('input', (e) => {
    widthValueDisplay.textContent = e.target.value;
    applyStylesToSVG();
});
strokeLinejoinSelect.addEventListener('change', applyStylesToSVG);
fillToggle.addEventListener('change', applyStylesToSVG);

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

// 外枠（上・左・右）のゴミアンカーを除去し、画像下端に達した切れ端のみを直線で結ぶ
function fixBottomOnlyPath(path, minX, maxX, minY, maxY) {
    const d = path.getAttribute('d');
    if (!d) return;

    const matches = d.match(/-?\d+(\.\d+)?/g);
    if (!matches || matches.length < 4) return;

    const points = [];
    for (let i = 0; i < matches.length; i += 2) {
        points.push([parseFloat(matches[i]), parseFloat(matches[i+1])]);
    }

    const margin = 8; // 枠判定マージン(px)
    const bottomY = maxY - margin;

    // 上・左・右の枠線にベタ貼りになっているアンカーポイントを徹底除外
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

    // 画像の最下部に接しているアンカーポイントを特定
    const bottomPoints = validPoints.filter(([x, y]) => y >= bottomY);

    if (bottomPoints.length >= 2) {
        // 下端に達している「最も左の点」と「最も右の点」のX座標を求める
        const minBottomX = Math.min(...bottomPoints.map(p => p[0]));
        const maxBottomX = Math.max(...bottomPoints.map(p => p[0]));

        // 不要な「画面下の隅（角）」に飛んでいる点を除去し、下端のY座標を綺麗に整える
        const finalPoints = validPoints.map(([x, y]) => {
            if (y >= bottomY) {
                // 最底面のY座標をぴったり揃える
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
    const isFill = fillToggle.checked;
    
    const personPaths = svg.querySelectorAll('path[data-type="person"]');
    const holePaths = svg.querySelectorAll('path[data-type="hole"]');
    
    personPaths.forEach(path => {
        path.setAttribute('fill', isFill ? '#000000' : 'none');
        path.setAttribute('stroke', '#000000');
        path.setAttribute('stroke-width', width);
        path.setAttribute('stroke-linejoin', join);
    });

    holePaths.forEach(path => {
        if (isFill) {
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

downloadBtn.addEventListener('click', async () => {
    const svg = svgContainer.querySelector('svg');
    if (!svg) return;

    const serializer = new XMLSerializer();
    let svgString = serializer.serializeToString(svg);
    if (!svgString.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
        svgString = svgString.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });

    const defaultFileName = localStorage.getItem('lastSavedSVGName') || 'silhouette.svg';

    try {
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: defaultFileName,
                types: [{
                    description: 'SVG Image',
                    accept: { 'image/svg+xml': ['.svg'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();

            localStorage.setItem('lastSavedSVGName', handle.name);
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
        console.log("保存がキャンセルされました:", error);
    }
});