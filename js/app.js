// HTMLの要素を取得
const fileInput = document.getElementById('file-input');
const svgContainer = document.getElementById('svg-container');
const strokeWidthSlider = document.getElementById('stroke-width');
const widthValueDisplay = document.getElementById('width-value');
const strokeLinejoinSelect = document.getElementById('stroke-linejoin');
const downloadBtn = document.getElementById('download-btn');

// ==========================================
// 1. 画像の読み込み処理
// ==========================================
fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // 読み込み中表示
    svgContainer.innerHTML = '<p>処理中...</p>';

    try {
        let imageURL = '';
        
        // HEIC画像の場合はJPEGに変換（iPhoneユーザー対応）
        if (file.name.toLowerCase().endsWith('.heic')) {
            console.log('HEIC形式を検出しました。変換します...');
            const convertedBlob = await heic2any({ blob: file, toType: 'image/jpeg' });
            imageURL = URL.createObjectURL(convertedBlob);
        } else {
            // PNGやJPEGはそのまま読み込む
            imageURL = URL.createObjectURL(file);
        }

        console.log('画像読み込み成功:', imageURL);

        // ★今回は骨組みのテストとして、画像を読み込んだら「ダミーのSVG」を表示します。
        // （次のステップで、ここにMediaPipe等のAI画像解析処理を組み込みます）
        displayDummySVG();
        
        // ダウンロードボタンを有効化
        downloadBtn.disabled = false;

    } catch (error) {
        console.error('画像処理エラー:', error);
        svgContainer.innerHTML = '<p style="color:red;">画像の読み込みに失敗しました</p>';
    }
});


// ==========================================
// 2. リアルタイムなUI操作（ここがサクサク動く部分）
// ==========================================

// 線の太さスライダーを動かした時
strokeWidthSlider.addEventListener('input', (event) => {
    const newWidth = event.target.value;
    widthValueDisplay.textContent = newWidth; // 数値の表示を更新
    
    // SVG内のすべてのパス(線)の太さを直接書き換える（遅延ゼロで反映）
    const paths = svgContainer.querySelectorAll('path');
    paths.forEach(path => {
        path.style.strokeWidth = newWidth + 'px';
    });
});

// 角の形プルダウンを変更した時
strokeLinejoinSelect.addEventListener('change', (event) => {
    const newJoin = event.target.value;
    
    // 角の処理を直接書き換える
    const paths = svgContainer.querySelectorAll('path');
    paths.forEach(path => {
        path.style.strokeLinejoin = newJoin;
    });
});


// ==========================================
// 3. テスト用のダミーSVG生成関数
// ==========================================
function displayDummySVG() {
    // MediaPipe実装までのテスト用として、星型のSVGパスを描画
    const dummySVG = `
        <svg id="result-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="80%" height="80%">
            <!-- pathタグが「線」のデータ。ここに後々、人の輪郭データが入ります -->
            <path d="M50 15 L61 35 L85 35 L66 50 L73 75 L50 60 L27 75 L34 50 L15 35 L39 35 Z" 
                  fill="none" 
                  stroke="black" 
                  stroke-width="2" 
                  stroke-linejoin="round"
                  style="transition: stroke-width 0.1s, stroke-linejoin 0.1s;"
            />
        </svg>
    `;
    svgContainer.innerHTML = dummySVG;
}