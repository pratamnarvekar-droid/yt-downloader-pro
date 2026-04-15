const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Detect Platform
const isWin = process.platform === 'win32';
const YT_DLP = isWin ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';
const FFMPEG_DIR = isWin ? __dirname : '/usr/bin';

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const downloadTasks = {};

// Use a real Browser User-Agent to prevent YouTube from blocking the server
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

app.post('/video-info', (req, res) => {
    const { url } = req.body;
    console.log("Analyzing URL:", url);

    // --user-agent helps bypass bot detection
    const child = spawn(YT_DLP, [
        '--user-agent', USER_AGENT,
        '-j', 
        '--flat-playlist', 
        '--no-warnings', 
        url
    ]);
    
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);

    child.on('close', (code) => {
        if (code !== 0) {
            console.error("yt-dlp error:", stderr);
            return res.status(500).json({ error: "YouTube blocked the request or link is invalid." });
        }
        try {
            const results = stdout.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
            const isPlaylist = results.length > 1 || results[0]._type === 'playlist';

            if (isPlaylist) {
                res.json({
                    type: 'playlist',
                    title: results[0].playlist_title || "Playlist",
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
        } catch (e) { 
            console.error("Parse error:", e);
            res.status(500).json({ error: "Failed to process video info." }); 
        }
    });
});

app.post('/prepare-download', (req, res) => {
    const { url, height } = req.body;
    const taskId = Date.now().toString();
    const isAudio = height === 'audio';
    const fileName = `dl_${taskId}.${isAudio ? 'mp3' : 'mp4'}`;
    const outputPath = path.join(tempDir, fileName);

    downloadTasks[taskId] = { status: 'processing', progress: '0%', fileId: null };

    let args = isAudio 
        ? ['-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3'] 
        : ['-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`, '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:v libx264 -preset ultrafast -crf 23 -c:a aac -pix_fmt yuv420p'];

    const downloader = spawn(YT_DLP, [
        '--user-agent', USER_AGENT,
        ...args,
        '--ffmpeg-location', FFMPEG_DIR,
        '--newline',
        '-o', outputPath,
        url
    ]);

    downloader.stderr.on('data', (data) => {
        const match = data.toString().match(/(\d+(\.\d+)?%)/);
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

app.get('/poll-status', (req, res) => res.json(downloadTasks[req.query.taskId] || { status: 'not_found' }));

app.get('/fetch-file', (req, res) => {
    const filePath = path.join(tempDir, req.query.fileId);
    if (fs.existsSync(filePath)) {
        res.download(filePath, req.query.title || 'download.mp4', () => {
            setTimeout(() => { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); }, 60000);
        });
    } else { res.status(404).send("File expired."); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
