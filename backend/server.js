/// ==========================================
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

// --- Security & Environment Variable Verification ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('⚠️ Warning: JWT_SECRET is not defined in .env! Using temporary fallback secret.');
}
const ACTIVE_JWT_SECRET = JWT_SECRET || 'default_secret';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dashboard_db';
if (!process.env.MONGO_URI) {
  console.warn('⚠️ Warning: MONGO_URI is not defined in .env! Using local MongoDB fallback.');
}

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

// --- WiFi Telemetry Endpoint (ESP32 HTTP POST Target) ---
let lastSavedTimes = {};

app.post('/api/sensor', async (req, res) => {
  try {
    const payload = req.body;

    // 1. กระจายข้อมูลสดเข้า Frontend ทันที
    io.emit('dashboard_update', payload);

    // 2. ตรวจสอบและ Broadcast Alert (ถ้ามีเข้าเงื่อนไข)
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

    // 3. ตรวจสอบการบันทึกลง Database แยกราย User ตาม Setting
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

// --- Settings & CSV Routes ---
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


// Static port connection for UART communication with ESP32-S3
// Communicate UART : Static COM1, line 120
// 1. ใส่ไว้บรรทัดแรกสุดของไฟล์
// require('dotenv').config();

// 2. ใส่ console.log บรรทัดนี้เพื่อเช็กค่าที่อ่านได้
// console.log('MONGO_URI is:', process.env.MONGO_URI);

// // File: backend/server.js
// const express = require('express');
// const http = require('http');
// const mongoose = require('mongoose');
// const { Server } = require('socket.io');
// const cors = require('cors');
// const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
// const { Parser } = require('json2csv');
// const { SerialPort } = require('serialport');
// const { ReadlineParser } = require('@serialport/parser-readline');

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server, { cors: { origin: '*' } });

// app.use(cors());
// app.use(express.json());

// // ดึงค่ามาใช้งานผ่าน process.env
// const JWT_SECRET = process.env.JWT_SECRET;

// mongoose.connect(process.env.MONGO_URI)
//   .then(() => console.log('MongoDB Connected successfully!'))
//   .catch(err => console.error('MongoDB Connection Error:', err));

// // --- MongoDB Schemas ---
// const UserSchema = new mongoose.Schema({
//   username: { type: String, required: true, unique: true },
//   password: { type: String, required: true }
// });
// const User = mongoose.model('User', UserSchema);

// const SettingsSchema = new mongoose.Schema({
//   userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   saveInterval: { type: String, default: 'realtime' } // 'realtime', '10s', '5m', '1h'
// });
// const Settings = mongoose.model('Settings', SettingsSchema);

// const SensorDataSchema = new mongoose.Schema({
//   userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
//   voltage: Number,
//   resistance: Number,
//   current: Number,
//   ldr: Number,
//   btn1Raw: Number,
//   btn1Debounced: Number,
//   btn2Raw: Number,
//   btn2Debounced: Number,
//   timestamp: { type: Date, default: Date.now }
// });
// const SensorData = mongoose.model('SensorData', SensorDataSchema);

// // --- Auth Routes ---
// app.post('/api/register', async (req, res) => {
//   try {
//     const { username, password } = req.body;
//     const hashedPassword = await bcrypt.hash(password, 10);
//     const user = await User.create({ username, password: hashedPassword });
//     await Settings.create({ userId: user._id, saveInterval: 'realtime' });
//     res.json({ success: true, message: 'Registered successfully' });
//   } catch (err) {
//     res.status(400).json({ error: err.message });
//   }
// });

// app.post('/api/login', async (req, res) => {
//   const { username, password } = req.body;
//   const user = await User.findOne({ username });
//   if (user && await bcrypt.compare(password, user.password)) {
//     const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
//     res.json({ token, username: user.username, userId: user._id });
//   } else {
//     res.status(401).json({ error: 'Invalid Credentials' });
//   }
// });

// // --- Data Export & Management Routes ---
// app.get('/api/download-csv', async (req, res) => {
//   const token = req.query.token || req.headers.authorization?.split(' ')[1];
//   if (!token) return res.status(401).send('Unauthorized');
  
//   try {
//     const decoded = jwt.verify(token, JWT_SECRET);
//     const data = await SensorData.find({ userId: decoded.userId }).sort({ timestamp: -1 }).limit(1000);
    
//     const fields = ['timestamp', 'voltage', 'resistance', 'current', 'ldr', 'btn1Raw', 'btn1Debounced', 'btn2Raw', 'btn2Debounced'];
//     const json2csvParser = new Parser({ fields });
//     const csv = json2csvParser.parse(data);

//     res.header('Content-Type', 'text/csv');
//     res.attachment('sensor_data.csv');
//     res.send(csv);
//   } catch (err) {
//     res.status(500).send('Error generating CSV');
//   }
// });

// app.post('/api/settings', async (req, res) => {
//   const { userId, saveInterval } = req.body;
//   await Settings.findOneAndUpdate({ userId }, { saveInterval }, { upsert: true });
//   res.json({ success: true });
// });

// app.delete('/api/clear-data', async (req, res) => {
//   const { userId } = req.body;
//   await SensorData.deleteMany({ userId });
//   res.json({ success: true, message: 'Data cleared' });
// });

// // --- Serial Connection & Realtime Handling ---
// const SERIAL_PORT_PATH = 'COM1'; // ปรับตาม Serial Port ของระบบ
// let lastSavedTimes = {};

// let port;
// try {
//   port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: 115200 });
//   const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

//   parser.on('data', async (data) => {
//     try {
//       const payload = JSON.parse(data.trim());
      
//       // 1. Broadcast ไปยัง Frontend ทุกเครื่อง
//       io.emit('dashboard_update', payload);

//       // 2. บันทึกลง DB ตาม Setting ของ User ที่ active
//       const activeUsers = await Settings.find();
//       const now = Date.now();

//       for (let setting of activeUsers) {
//         const uId = setting.userId.toString();
//         const lastSaved = lastSavedTimes[uId] || 0;
//         let shouldSave = false;

//         if (setting.saveInterval === 'realtime') shouldSave = true;
//         else if (setting.saveInterval === '10s' && now - lastSaved >= 10000) shouldSave = true;
//         else if (setting.saveInterval === '5m' && now - lastSaved >= 300000) shouldSave = true;
//         else if (setting.saveInterval === '1h' && now - lastSaved >= 3600000) shouldSave = true;

//         if (shouldSave) {
//           lastSavedTimes[uId] = now;
//           await SensorData.create({
//             userId: setting.userId,
//             ...payload
//           });
//         }
//       }
//     } catch (e) {
//       // Ignored non-json lines
//     }
//   });

//   port.on('error', (err) => console.error('Serial Error:', err.message));
// } catch (e) {
//   console.log('Serial Port initialization failed or not connected.');
// }

// io.on('connection', (socket) => {
//   console.log('Client connected:', socket.id);
// });

// const PORT = 5000;
// server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));


