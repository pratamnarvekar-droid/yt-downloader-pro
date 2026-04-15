const getInfoBtn = document.getElementById('getInfoBtn');
const videoUrl = document.getElementById('videoUrl');
const videoDetails = document.getElementById('videoDetails');
const loading = document.getElementById('loading');

// 1. Theme Toggle
const currentTheme = localStorage.getItem('theme') || 'dark';
document.body.setAttribute('data-theme', currentTheme);

function toggleTheme() {
    const theme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

// 2. Thumbnail Downloader
async function saveThumb(url, title) {
    const response = await fetch(url);
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${title.substring(0,20)}_thumb.jpg`;
    link.click();
}

// 3. Main Analyze Function
getInfoBtn.addEventListener('click', async () => {
    const url = videoUrl.value.trim();
    if (!url) return alert('Enter a URL');

    loading.style.display = 'block';
    videoDetails.style.display = 'none';

    try {
        const res = await fetch('/video-info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.type === 'playlist') {
            renderPlaylist(data);
        } else {
            renderVideo(data, url);
        }
    } catch (e) { alert("Analysis failed."); }
    finally { loading.style.display = 'none'; }
});

function renderVideo(data, url) {
    videoDetails.innerHTML = `
        <div class="video-card">
            <div class="thumb-box">
                <img src="${data.thumbnail}">
                <div class="duration">${data.duration}</div>
            </div>
            <div class="content">
                <h2>${data.title}</h2>
                <div style="color:var(--text-dim); font-size:14px; margin-bottom:15px;">👁️ ${data.views} views</div>
                <button onclick="saveThumb('${data.thumbnail}', '${data.title}')" style="background:none; border:1px solid var(--primary); color:var(--primary); padding:5px 10px; border-radius:5px; cursor:pointer; font-size:12px; margin-bottom:15px;">🖼️ Download Thumbnail</button>
                <div class="btn-grid" id="qGrid"></div>
            </div>
        </div>
    `;

    const qGrid = document.getElementById('qGrid');
    data.formats.forEach(f => {
        const div = document.createElement('div');
        div.className = 'dl-item';
        div.innerHTML = `
            <button class="q-btn">${f.label}</button>
            <div class="progress-wrap"><div class="p-bar"></div></div>
        `;
        const btn = div.querySelector('.q-btn');
        const bar = div.querySelector('.p-bar');
        const wrap = div.querySelector('.progress-wrap');

        btn.onclick = async () => {
            btn.disabled = true;
            wrap.style.display = 'block';
            
            const prep = await fetch('/prepare-download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, height: f.height })
            });
            const { taskId } = await prep.json();

            const poll = setInterval(async () => {
                const statusRes = await fetch(`/poll-status?taskId=${taskId}`);
                const status = await statusRes.json();
                if (status.status === 'processing') {
                    bar.style.width = status.progress;
                    btn.innerText = `Merging ${status.progress}`;
                } else if (status.status === 'completed') {
                    clearInterval(poll);
                    bar.style.width = '100%';
                    btn.innerText = "✅ Ready!";
                    window.location.href = `/fetch-file?fileId=${status.fileId}&title=${encodeURIComponent(data.title)}`;
                    setTimeout(() => { btn.disabled = false; btn.innerText = f.label; wrap.style.display='none'; }, 5000);
                }
            }, 1500);
        };
        qGrid.appendChild(div);
    });
    videoDetails.style.display = 'block';
}

function renderPlaylist(data) {
    videoDetails.innerHTML = `
        <div class="video-card" style="display:block; padding:25px;">
            <h2 style="margin:0;">Playlist: ${data.title}</h2>
            <p style="color:var(--text-dim);">${data.videos.length} videos found</p>
            <div class="playlist-list">
                ${data.videos.map(v => `
                    <div class="p-item">
                        <img src="${v.thumbnail}">
                        <div class="p-item-info">
                            <div>${v.title}</div>
                            <span style="font-size:12px; color:var(--text-dim);">${v.duration}</span>
                        </div>
                        <button onclick="quickAnalyze('${v.url}')">Analyze</button>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    videoDetails.style.display = 'block';
}

function quickAnalyze(url) {
    videoUrl.value = url;
    getInfoBtn.click();
}