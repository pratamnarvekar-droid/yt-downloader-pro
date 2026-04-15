const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const isWin = process.platform === 'win32';
const YT_DLP = isWin ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';
const FFMPEG_DIR = isWin ? __dirname : '/usr/bin';

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const downloadTasks = {};

// 🛠️ THE BYPASS CONFIGURATION
const bypassArgs = [
    '--impersonate', 'chrome', // Mimic a real Chrome browser fingerprint
    '--extractor-args', 'youtube:player_client=web,ios', // Use both Web and iOS clients to find data
    '--no-check-certificates',
    '--geo-bypass'
];

app.post('/video-info', (req, res) => {
    const { url } = req.body;
    console.log("Analyzing URL with bypass flags:", url);

    const child = spawn(YT_DLP, [
        ...bypassArgs,
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
            console.error("YT-DLP ERROR LOG:", stderr);
            // Check if blocked by bot detection
            if (stderr.includes("Sign in to confirm you’re not a bot")) {
                return res.status(500).json({ error: "YouTube is blocking the server. Try again in 5 minutes or use a different link." });
            }
            return res.status(500).json({ error: "Analysis failed. YouTube blocked the connection." });
        }
        try {
            const results = stdout.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
            const info = results[0];
            res.json({
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
        } catch (e) { 
            res.status(500).json({ error: "Data parsing error." }); 
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

    let formatArgs = isAudio 
        ? ['-f', 'bestaudio/best', '--extract-audio', '--audio-format', 'mp3'] 
        : ['-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}]`, '--merge-output-format', 'mp4', '--postprocessor-args', 'ffmpeg:-c:v libx264 -preset ultrafast -crf 23 -c:a aac -pix_fmt yuv420p'];

    const downloader = spawn(YT_DLP, [
        ...bypassArgs,
        ...formatArgs,
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
