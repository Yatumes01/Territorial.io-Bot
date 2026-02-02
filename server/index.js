const express = require('express');
const cors = require('cors');
const path = require('path');
const bot = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

app.get('/api/state', (req, res) => {
  res.json(bot.getState());
});

app.post('/api/start', async (req, res) => {
  bot.startBot();
  res.json({ success: true });
});

app.post('/api/stop', async (req, res) => {
  await bot.stopBot();
  res.json({ success: true });
});

app.post('/api/preview', (req, res) => {
  const { enabled } = req.body;
  bot.togglePreview(enabled);
  res.json({ success: true });
});

app.get('/api/screenshot', async (req, res) => {
  const state = bot.getState();
  if (state.previewEnabled && state.lastScreenshot) {
    res.json({ screenshot: state.lastScreenshot });
  } else {
    res.json({ screenshot: null });
  }
});

let screenshotInterval = null;

setInterval(async () => {
  const state = bot.getState();
  if (state.running && state.previewEnabled) {
    await bot.takeScreenshot();
  }
}, 10000);

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
