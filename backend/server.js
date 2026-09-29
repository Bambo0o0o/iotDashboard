// ==========================================
// File: backend/server.js
// IoT Dashboard Backend Server (Express + Socket.IO + MongoDB + Alert System)
// ==========================================
require('dotenv').config();

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Parser } = require('json2csv');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// --- ตรวจสอบค่าภาพแวดล้อม Security & Environment Variable Verification ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️ Warning: JWT_SECRET is not defined in .env! Using temporary fallback secret.');
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'default_secret';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dashboard_db';
if (!process.env.MONGO_URI) {
  console.warn('⚠️ Warning: MONGO_URI is not defined in .env! Using local MongoDB fallback.');
}

// เชื่อมต่อ MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected successfully!'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- Database Schemas ---
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const SettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  saveInterval: { type: String, default: 'realtime' }
});
const Settings = mongoose.model('Settings', SettingsSchema);

const SensorDataSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  username: { type: String, default: 'Unknow' },
  voltage: Number,
  resistance: Number,
  current: Number,
  ldr: Number,
  btn1Raw: Number,
  btn1Debounced: Number,
  btn2Raw: Number,
  btn2Debounced: Number,
  timestamp: { type: Date, default: Date.now }
});
const SensorData = mongoose.model('SensorData', SensorDataSchema);

// --- Auth Routes ---
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword });
    await Settings.create({ userId: user._id.toString(), saveInterval: 'realtime' });
    res.json({ success: true, message: 'Registered successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ userId: user._id, username: user.username }, ACTIVE_JWT_SECRET);
    res.json({ token, username: user.username, userId: user._id });
  } else {
    res.status(401).json({ error: 'Invalid Credentials' });
  }
});

app.get('/api/me', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, ACTIVE_JWT_SECRET);
    res.json({ userId: decoded.userId, username: decoded.username, token });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- Helper Function: Alert Checking System ---
/**
 * @brief ฟังก์ชันตรวจสอบค่าความผิดปกติของเซนเซอร์เพื่อส่งการแจ้งเตือน
 */
function checkSensorAlerts(payload) {
  const alerts = [];

  // 1. ตรวจสอบแรงดันไฟฟ้า (Voltage Alert)
  if (payload.voltage > 3.0) {
    alerts.push({ type: 'WARNING', sensor: 'voltage', message: `HIGH VOLTAGE DETECTED: ${payload.voltage.toFixed(2)}V (Threshold > 3.0V)` });
  } else if (payload.voltage < 0.5 && payload.voltage > 0) {
    alerts.push({ type: 'WARNING', sensor: 'voltage', message: `LOW VOLTAGE DETECTED: ${payload.voltage.toFixed(2)}V (Threshold < 0.5V)` });
  }

  // 2. ตรวจสอบระดับแสง LDR (Light Alert)
  if (payload.ldr > 3500) {
    alerts.push({ type: 'INFO', sensor: 'ldr', message: `BRIGHT LIGHT DETECTED: LDR value ${payload.ldr}` });
  } else if (payload.ldr < 500 && payload.ldr > 0) {
    alerts.push({ type: 'INFO', sensor: 'ldr', message: `DARK ENVIRONMENT DETECTED: LDR value ${payload.ldr}` });
  }

  // 3. ตรวจสอบกระแสไฟฟ้า (Current Alert)
  if (payload.current > 2.5) {
    alerts.push({ type: 'CRITICAL', sensor: 'current', message: `OVERCURRENT ALERT: ${payload.current.toFixed(2)}mA (Threshold > 2.5mA)` });
  }

  return alerts;
}

// --- WiFi Telemetry Endpoint (ESP32 HTTPS POST Target) ---
let lastSavedTimes = {};

app.post('/api/sensor', async (req, res) => {
  try {
    const payload = req.body;

    // 1. กระจายข้อมูลสดเข้า Frontend ทันทีผ่าน Socket.IO
    io.emit('dashboard_update', payload);

    // 2. ตรวจสอบและ Broadcast Alert (ถ้ามีเงื่อนไขตรงตามที่กำหนด)
    const alerts = checkSensorAlerts(payload);
    if (alerts.length > 0) {
      alerts.forEach(alert => {
        console.log(`🚨 [ALERT] [${alert.type}] ${alert.message}`);
        io.emit('sensor_alert', {
          ...alert,
          timestamp: new Date()
        });
      });
    }

    // 3. ตรวจสอบการบันทึกลง Database แยกราย User ตาม Setting (Save Interval)
    let activeSettings = await Settings.find();
    if (!activeSettings.some(s => s.userId === 'unknow')) {
      const defaultUnknowSetting = await Settings.create({ userId: 'unknow', saveInterval: 'realtime' });
      activeSettings.push(defaultUnknowSetting);
    }

    const now = Date.now();
    for (let setting of activeSettings) {
      const uId = setting.userId;
      const lastSaved = lastSavedTimes[uId] || 0;
      let shouldSave = false;

      if (setting.saveInterval === 'realtime') shouldSave = true;
      else if (setting.saveInterval === '10s' && now - lastSaved >= 10000) shouldSave = true;
      else if (setting.saveInterval === '5m' && now - lastSaved >= 300000) shouldSave = true;
      else if (setting.saveInterval === '1h' && now - lastSaved >= 3600000) shouldSave = true;

      if (shouldSave) {
        lastSavedTimes[uId] = now;
        let username = 'Unknow';
        if (uId !== 'unknow') {
          try {
            const uObj = await User.findById(uId);
            if (uObj) username = uObj.username;
          } catch (e) {}
        }

        await SensorData.create({
          userId: uId,
          username: username,
          ...payload
        });
      }
    }

    res.json({ status: 'ok', alertsTriggered: alerts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings & CSV Export Routes ---
app.get('/api/download-csv', async (req, res) => {
  const token = req.query.token || req.headers.authorization?.split(' ')[1];
  let currentUserId = 'unknow';
  let currentUsername = 'Unknow';

  if (token) {
    try {
      const decoded = jwt.verify(token, ACTIVE_JWT_SECRET);
      currentUserId = decoded.userId;
      currentUsername = decoded.username || 'Unknow';
    } catch (err) {}
  }

  try {
    const data = await SensorData.find({ userId: currentUserId }).sort({ timestamp: -1 }).limit(1000);
    const formattedData = data.map(item => ({
      user: item.username || currentUsername,
      timestamp: item.timestamp,
      voltage: item.voltage,
      resistance: item.resistance,
      current: item.current,
      ldr: item.ldr,
      btn1Raw: item.btn1Raw,
      btn1Debounced: item.btn1Debounced,
      btn2Raw: item.btn2Raw,
      btn2Debounced: item.btn2Debounced
    }));

    const fields = ['user', 'timestamp', 'voltage', 'resistance', 'current', 'ldr', 'btn1Raw', 'btn1Debounced', 'btn2Raw', 'btn2Debounced'];
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formattedData);

    res.header('Content-Type', 'text/csv');
    res.attachment(`sensor_data_${currentUsername}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV');
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { userId, saveInterval } = req.body;
    const targetUser = userId || 'unknow';

    await Settings.findOneAndUpdate(
      { userId: targetUser },
      { saveInterval },
      { upsert: true, new: true }
    );

    io.emit('setting_updated', { userId: targetUser, saveInterval });
    res.json({ success: true, message: `Setting updated to ${saveInterval}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clear-data', async (req, res) => {
  const { userId } = req.body;
  const targetUser = userId || 'unknow';
  await SensorData.deleteMany({ userId: targetUser });
  res.json({ success: true, message: 'Data cleared successfully' });
});

io.on('connection', (socket) => {
  console.log('⚡ Client Connected:', socket.id);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));