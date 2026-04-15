const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 🔍 CROSS-PLATFORM ENGINE DETECTION
// If on Windows, look for local .exe files. If on Linux (Live Server), use global commands.
const isWin = process.platform === 'win32';
const YT_DLP = isWin ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';
const FFMPEG_DIR = isWin ? __dirname : '/usr/bin';

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// Task memory to track progress for the polling system
const downloadTasks = {};

// 1️⃣ SYSTEM STATS (For that "Developer" feel)
app.get('/system-stats', (req, res) => {
    res.json({
        ram: `${((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1)}%`,
        uptime: `${(os.uptime() / 3600).toFixed(1)}h`,
        platform: process.platform
    });
});

// 2️⃣ VIDEO INFO API (Handles Single Videos & Playlists)
app.post('/video-info', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    // Use --flat-playlist to quickly list items if it's a playlist
    const child = spawn(YT_DLP, ['-j', '--flat-playlist', '--no-warnings', url]);
    
    let results = [];
    child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => { try { results.push(JSON.parse(line)); } catch(e) {} });
    });

    child.on('close', (code) => {
        if (code !== 0 || results.length === 0) return res.status(500).json({ error: "Invalid URL or connection error" });

        const isPlaylist = results.length > 1 || results[0]._type === 'playlist';

        if (isPlaylist) {
            res.json({
                type: 'playlist',
                title: results[0].playlist_title || "YouTube Playlist",
                videos: results.map(v => ({
                    title: v.title,
                    url: `https://www.youtube.com/watch?v=${v.id}`,
                    thumbnail: v.thumbnails ? v.thumbnails[0].url : "",
                    duration: v.duration_string || "0:00"
                }))
            });
        } else {
            const info = results[0];
            res.json({
                type: 'video',
                title: info.title,
                thumbnail: info.thumbnail,
                duration: info.duration_string || "0:00",
                views: (info.view_count || 0).toLocaleString(),
                formats: [
                    { label: '🎵 MP3 Audio', height: 'audio' },
                    { label: '🎬 720p HD', height: '720' },
                    { label: '🎬 1080p FHD', height: '1080' },
                    { label: '🎬 4K Ultra', height: '2160' }
                ]
            });
        }
    });
});

// 3️⃣ PREPARE DOWNLOAD (The Merging Engine)
app.post('/prepare-download', (req, res) => {
    const { url, height } = req.body;
    const taskId = Date.now().toString();
    const isAudio = height === 'audio';
    const ext = isAudio ? 'mp3' : 'mp4';
    const fileName = `dl_${taskId}.${ext}`;
    const outputPath = path.join(tempDir, fileName);

    downloadTasks[taskId] = { status: 'processing', progress: '0%', fileId: null };

    let args = [];
    if (isAudio) {
        args = ['-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3'];
    } else {
        args = [
            '-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`,
            '--merge-output-format', 'mp4',
            // CRITICAL: libx264 + ultrafast ensures video is visible and processes quickly
            '--postprocessor-args', 'ffmpeg:-c:v libx264 -preset ultrafast -crf 23 -c:a aac -pix_fmt yuv420p'
        ];
    }

    const downloader = spawn(YT_DLP, [
        ...args,
        '--ffmpeg-location', FFMPEG_DIR,
        '--newline',
        '-o', outputPath,
        url
    ]);

    downloader.stderr.on('data', (data) => {
        const msg = data.toString();
        const match = msg.match(/(\d+(\.\d+)?%)/);
        if (match) downloadTasks[taskId].progress = match[0];
    });

    downloader.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
            downloadTasks[taskId].status = 'completed';
            downloadTasks[taskId].fileId = fileName;
        } else {
            downloadTasks[taskId].status = 'failed';
        }
    });

    res.json({ taskId });
});

// 4️⃣ POLL STATUS (Keeps the browser waiting without timeout)
app.get('/poll-status', (req, res) => {
    res.json(downloadTasks[req.query.taskId] || { status: 'not_found' });
});

// 5️⃣ FETCH FILE (Sends the final renamed file)
app.get('/fetch-file', (req, res) => {
    const { fileId, title } = req.query;
    const filePath = path.join(tempDir, fileId);

    if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        // Clean title for any OS
        const safeTitle = (title || "video").replace(/[<>:"/\\|?*]/g, "");
        
        res.download(filePath, `${safeTitle}${ext}`, (err) => {
            // Clean up: Delete the file 1 minute after download starts
            setTimeout(() => { 
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 
            }, 60000);
        });
    } else {
        res.status(404).send("File expired. Please try again.");
    }
});

// Port handling for Live Servers (Process.env.PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🛠️ Mode: ${isWin ? 'Windows (Local)' : 'Linux (Live)'}`);
});