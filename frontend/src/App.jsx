// ============================================================================
// File: frontend/src/App.jsx
// IoT Dashboard Frontend (React + Socket.IO + Chart.js + Tailwind CSS)
// Adding : Alert signal loss from hardware.
// ============================================================================
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

// กำหนด URL ของ Backend Service
const SOCKET_URL = process.env.REACT_APP_BACKEND_URL || 'https://iotdashboard-mq5d.onrender.com';
const socket = io(SOCKET_URL);

// ค่ามาตรฐานความปลอดภัยต่อสายตา (Safety Thresholds)
const DARK_THRESHOLD = 100;      // ค่าที่ต่ำกว่านี้ถือว่ามืด -> ปรับกราฟเป็น 0
const SAFE_LIGHT_MAX = 800;      // ค่าสูงสุดที่ปลอดภัยต่อสายตา -> เกินนี้จะแจ้งเตือน
const MAX_LDR_RAW = 1024;        // ค่า Maximum Raw จาก LDR (หากเป็น ESP32 ให้เปลี่ยนเป็น 4095)

// ================= ANALOG NEEDLE GAUGE COMPONENT =================
function AnalogGauge({ value, min = 0, max = 100, unit = '', color = '#3b82f6', darkMode }) {
  const clampedValue = Math.min(Math.max(value, min), max);
  const percentage = (clampedValue - min) / (max - min);
  const angle = -90 + percentage * 180;

  const radian = (angle * Math.PI) / 180;
  const needleX = 100 + 65 * Math.sin(radian);
  const needleY = 100 - 65 * Math.cos(radian);

  return (
    <div className="flex flex-col items-center justify-center w-full">
      <svg viewBox="0 0 200 120" className="w-48 h-28 overflow-visible">
        {/* เส้นโค้งพื้นหลัง */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={darkMode ? '#374151' : '#e5e7eb'}
          strokeWidth="16"
          strokeLinecap="round"
        />
        {/* เส้นโค้งระดับตามค่าข้อมูล */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray="251.2"
          strokeDashoffset={251.2 * (1 - percentage)}
          className="transition-all duration-300 ease-out"
        />
        {/* เข็มชี้วัด */}
        <line
          x1="100"
          y1="100"
          x2={needleX}
          y2={needleY}
          stroke="#ef4444"
          strokeWidth="3.5"
          strokeLinecap="round"
          className="transition-all duration-300 ease-out"
        />
        <circle cx="100" cy="100" r="7" fill={darkMode ? '#f3f4f6' : '#1f2937'} />
        <circle cx="100" cy="100" r="3" fill="#ef4444" />
      </svg>

      <div className="text-center mt-[-10px]">
        <span className="text-3xl font-extrabold" style={{ color }}>
          {typeof value === 'number' ? (value % 1 === 0 ? value : value.toFixed(2)) : value}
        </span>
        <span className="text-lg font-semibold ml-1 text-gray-400">{unit}</span>
      </div>
    </div>
  );
}

// ================= MAIN APP COMPONENT =================
export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState(null);
  const [isRegister, setIsRegister] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [saveInterval, setSaveInterval] = useState('realtime');
  const [isConnected, setIsConnected] = useState(socket.connected);
  
  // สถานะการแจ้งเตือนและ Popup Dropdown
  const [alerts, setAlerts] = useState([]);
  const [showAlertMenu, setShowAlertMenu] = useState(false);
  const alertMenuRef = useRef(null);

  // สถานะการตรวจจับสัญญาณ Controller ขาดหาย (Signal Alert Tab)
  const [signalLost, setSignalLost] = useState(false);
  const [signalLostReason, setSignalLostReason] = useState('');
  const [dismissSignalAlert, setDismissSignalAlert] = useState(false); // ควบคุมการกดปิดไอคอน [X]
  const lastDataTimeRef = useRef(Date.now());

  // สถานะค่าเซนเซอร์ปัจจุบัน
  const [sensor, setSensor] = useState({
    voltage: 0, resistance: 0, current: 0, ldr: 0,
    btn1Raw: 0, btn1Debounced: 0, btn2Raw: 0, btn2Debounced: 0
  });

  // ประวัติสำหรับกราฟเส้น
  const [analogHistory, setAnalogHistory] = useState([]);
  const [digitalHistory, setDigitalHistory] = useState([]);
  const [bandwidth, setBandwidth] = useState(0);

  // ตรวจสอบ Token เมื่อเริ่มต้นหน้า
  useEffect(() => {
    const savedUser = localStorage.getItem('user');
    const savedToken = localStorage.getItem('token');
    if (savedUser && savedToken) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // ปิด Popup แจ้งเตือนเมื่อคลิกพื้นที่อื่นภายนอก
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (alertMenuRef.current && !alertMenuRef.current.contains(event.target)) {
        setShowAlertMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ระบบตรวจจับสัญญาณขาดหาย (Signal Loss Detector)
  useEffect(() => {
    const checkSignalInterval = setInterval(() => {
      const timeSinceLastData = Date.now() - lastDataTimeRef.current;

      if (!isConnected) {
        setSignalLost(true);
        setSignalLostReason('Server Disconnected: การเชื่อมต่อกับ Server/Backend ขาดหาย');
      } else if (timeSinceLastData > 3000) { // หากไม่มีข้อมูลส่งเข้ามาเกิน 3 วินาที
        setSignalLost(true);
        setSignalLostReason('Controller Offline: บอร์ด Controller ไม่ได้ส่งข้อมูล (เช็กไฟเลี้ยงบอร์ด หรือสัญญาณ Wi-Fi)');
      } else {
        setSignalLost(false);
        setDismissSignalAlert(false); // รีเซ็ตสถานะเมื่อสัญญาณกลับมาปกติ
      }
    }, 1000);

    return () => clearInterval(checkSignalInterval);
  }, [isConnected]);

  // การรับฟังข้อมูล realtime ผ่าน Socket.IO
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // รับข้อมูลอัปเดตจากเซนเซอร์
    socket.on('dashboard_update', (data) => {
      // อัปเดตเวลาล่าสุดที่ได้รับข้อมูลจาก Controller
      lastDataTimeRef.current = Date.now();

      // 1. จำกัดค่า Resistance ไม่ให้เกิน 10,000 Ohm (10k)
      const rawResistance = data.resistance || 0;
      const clampedResistance = Math.min(Math.max(rawResistance, 0), 10000);

      // 2. กลับค่า LDR (Invert LDR Signal)
      const rawLdr = data.ldr || 0;
      const invertedLdr = Math.max(0, MAX_LDR_RAW - rawLdr);

      let chartLdr = invertedLdr;

      if (invertedLdr <= DARK_THRESHOLD) {
        chartLdr = 0;
      } else if (invertedLdr > SAFE_LIGHT_MAX) {
        chartLdr = SAFE_LIGHT_MAX;
        
        const alertMsg = `⚠️ BRIGHT LIGHT WARNING: LDR value (${invertedLdr}) exceeds safe threshold (${SAFE_LIGHT_MAX})`;
        setAlerts(prev => {
          if (prev.length > 0 && prev[0].message === alertMsg) return prev;
          return [{ type: 'WARNING', message: alertMsg, timestamp: new Date() }, ...prev.slice(0, 19)];
        });
      }

      const updatedSensorData = {
        ...data,
        resistance: clampedResistance,
        ldr: invertedLdr
      };

      setSensor(updatedSensorData);
      const timeStr = new Date().toLocaleTimeString();
      setBandwidth(JSON.stringify(data).length);

      // บันทึกประวัติสำหรับกราฟเส้น
      setAnalogHistory(prev => [
        ...prev.slice(-19),
        { 
          time: timeStr, 
          ldr: chartLdr, 
          v: data.voltage || 0, 
          r: clampedResistance, 
          i: data.current || 0 
        }
      ]);

      setDigitalHistory(prev => [
        ...prev.slice(-19),
        { 
          time: timeStr, 
          b1Raw: data.btn1Raw || 0, 
          b1Clean: data.btn1Debounced || 0, 
          b2Raw: data.btn2Raw || 0, 
          b2Clean: data.btn2Debounced || 0 
        }
      ]);
    });

    socket.on('sensor_alert', (alertData) => {
      setAlerts(prev => [alertData, ...prev.slice(0, 19)]);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('dashboard_update');
      socket.off('sensor_alert');
    };
  }, []);

  const handleClearAlerts = () => {
    setAlerts([]);
    setShowAlertMenu(false);
  };

  const handleAuth = async () => {
    const endpoint = isRegister ? '/api/register' : '/api/login';
    try {
      const res = await fetch(`${SOCKET_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();
      if (res.ok && !isRegister) {
        setUser(data);
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data));
        setUsernameInput('');
        setPasswordInput('');
      } else if (isRegister && data.success) {
        alert('ลงทะเบียนสำเร็จแล้ว สามารถเข้าสู่ระบบได้ทันที');
        setIsRegister(false);
      } else {
        alert(data.error || 'การยืนยันตัวตนล้มเหลว');
      }
    } catch (err) {
      alert('ไม่สามารถเชื่อมต่อกับ Backend ได้');
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  const handleDownloadCSV = () => {
    const token = localStorage.getItem('token') || '';
    window.open(`${SOCKET_URL}/api/download-csv?token=${token}`, '_blank');
  };

  const handleSaveIntervalChange = async (e) => {
    const newInterval = e.target.value;
    setSaveInterval(newInterval);

    try {
      await fetch(`${SOCKET_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user ? user.userId : 'unknow',
          saveInterval: newInterval
        })
      });
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  return (
    <div className={`min-h-screen p-4 transition-colors duration-200 ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}>
      
      {/* HEADER / NAVBAR */}
      <div className={`flex flex-wrap justify-between items-center p-4 rounded-lg shadow-md mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <h1 className="text-xl font-bold">My Dashboard (WiFi Mode)</h1>
        
        <div className="flex items-center gap-3">
          
          {/* BELL ICON & ALERT POPUP DROPDOWN */}
          <div className="relative" ref={alertMenuRef}>
            <button
              onClick={() => setShowAlertMenu(!showAlertMenu)}
              className={`p-2 rounded-lg border relative transition-colors ${
                darkMode 
                  ? 'border-gray-600 hover:bg-gray-700 bg-gray-800' 
                  : 'border-gray-300 hover:bg-gray-100 bg-white'
              }`}
              title="System Notifications"
            >
              <span className="text-lg">🔔</span>
              {alerts.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-extrabold rounded-full h-5 w-5 flex items-center justify-center animate-pulse shadow-md">
                  {alerts.length > 99 ? '99+' : alerts.length}
                </span>
              )}
            </button>

            {/* POPUP MENU */}
            {showAlertMenu && (
              <div className={`absolute right-0 mt-2 w-80 sm:w-96 rounded-xl shadow-2xl border z-50 overflow-hidden ${
                darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
              }`}>
                <div className={`p-3 flex justify-between items-center border-b ${darkMode ? 'border-gray-700 bg-gray-800/80' : 'border-gray-100 bg-gray-50'}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm">Notifications</span>
                    {alerts.length > 0 && (
                      <span className="px-2 py-0.5 text-xs rounded-full bg-red-500/20 text-red-400 font-semibold">
                        {alerts.length} New
                      </span>
                    )}
                  </div>
                  {alerts.length > 0 && (
                    <button
                      onClick={handleClearAlerts}
                      className="text-xs px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md transition-colors shadow-sm"
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-gray-700/50">
                  {alerts.length === 0 ? (
                    <div className="p-6 text-center text-sm text-gray-400">
                      🔔 No new notifications
                    </div>
                  ) : (
                    alerts.map((al, idx) => (
                      <div
                        key={idx}
                        className={`p-3 text-xs flex justify-between items-start gap-2 transition-colors ${
                          al.type === 'CRITICAL'
                            ? 'bg-red-500/10 hover:bg-red-500/20'
                            : al.type === 'WARNING'
                            ? 'bg-amber-500/10 hover:bg-amber-500/20'
                            : 'bg-blue-500/10 hover:bg-blue-500/20'
                        }`}
                      >
                        <div className="flex-1">
                          <span className={`inline-block font-bold px-1.5 py-0.5 rounded text-[10px] mr-1.5 mb-1 ${
                            al.type === 'CRITICAL'
                              ? 'bg-red-600 text-white'
                              : al.type === 'WARNING'
                              ? 'bg-amber-500 text-black'
                              : 'bg-blue-600 text-white'
                          }`}>
                            {al.type || 'INFO'}
                          </span>
                          <p className="font-medium leading-relaxed break-words">{al.message}</p>
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">
                          {al.timestamp ? new Date(al.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button 
            onClick={() => setDarkMode(!darkMode)} 
            className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
          >
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>

          <button 
            onClick={handleDownloadCSV} 
            className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
          >
            📥 Download CSV
          </button>

          <select 
            value={saveInterval} 
            onChange={handleSaveIntervalChange} 
            className="p-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-800 font-medium"
          >
            <option value="realtime">Setting: Realtime</option>
            <option value="10s">Setting: 10s</option>
            <option value="5m">Setting: 5m</option>
            <option value="1h">Setting: 1h</option>
          </select>

          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-green-500 font-bold text-sm">👤 {user.username}</span>
              <button onClick={handleLogout} className="px-2 py-1 bg-gray-600 text-white rounded text-xs">Logout</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input type="text" placeholder="User" value={usernameInput} onChange={e => setUsernameInput(e.target.value)} className="p-1 border rounded text-sm text-black w-20"/>
              <input type="password" placeholder="Pass" value={passwordInput} onChange={e => setPasswordInput(e.target.value)} className="p-1 border rounded text-sm text-black w-20"/>
              <button onClick={handleAuth} className="px-3 py-1 bg-green-600 text-white rounded text-sm">{isRegister ? 'Reg' : 'Login'}</button>
              <button onClick={() => setIsRegister(!isRegister)} className="text-xs text-blue-500 underline">{isRegister ? 'Login?' : 'Reg?'}</button>
            </div>
          )}
        </div>
      </div>

      {/* SIGNAL ALERT TAB (แสดงผลเมื่อขาดสัญญาณจาก Controller / Server) */}
      {signalLost && !dismissSignalAlert && (
        <div className="mb-4 p-3 bg-red-600/90 text-white rounded-lg shadow-lg flex items-center justify-between animate-pulse border border-red-500">
          <div className="flex items-center gap-2">
            <span className="text-xl">📡</span>
            <div>
              <span className="font-bold text-sm">SIGNAL ALERT: </span>
              <span className="text-xs sm:text-sm font-medium">{signalLostReason}</span>
            </div>
          </div>
          {/* ปุ่มไอคอนปิด [✕] ทางขวามือ */}
          <button
            onClick={() => setDismissSignalAlert(true)}
            className="p-1 text-white/80 hover:text-white hover:bg-red-700/60 rounded-md transition-colors text-lg font-bold leading-none px-2.5 ml-2"
            title="Dismiss Alert"
          >
            ✕
          </button>
        </div>
      )}

      {/* ROW 1: GAUGES & LED STATUS */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className={`col-span-12 md:col-span-4 p-4 rounded-lg shadow-md flex flex-col items-center ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className="text-md font-bold text-gray-400 mb-2">Voltage Gauge</h2>
          <AnalogGauge value={sensor.voltage} min={0} max={3.3} unit="V" color="#3b82f6" darkMode={darkMode} />
        </div>

        <div className={`col-span-12 md:col-span-4 p-4 rounded-lg shadow-md flex flex-col items-center ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h2 className="text-md font-bold text-gray-400 mb-2">Resistance Gauge</h2>
          <AnalogGauge value={sensor.resistance} min={0} max={10000} unit="Ω" color="#a855f7" darkMode={darkMode} />
        </div>

        <div className={`col-span-12 md:col-span-4 p-4 rounded-lg shadow-md flex flex-col justify-between ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="grid grid-cols-2 gap-2 h-full">
            <div className="flex flex-col items-center justify-center p-2 border border-gray-700 rounded-lg">
              <span className="text-xs font-bold mb-2">RED Lamp (Btn1)</span>
              <div className={`w-12 h-12 rounded-full transition-all duration-200 ${sensor.btn1Debounced ? 'bg-red-500 shadow-lg shadow-red-500/50' : 'bg-gray-600'}`}></div>
            </div>
            <div className="flex flex-col items-center justify-center p-2 border border-gray-700 rounded-lg">
              <span className="text-xs font-bold mb-2">GREEN Lamp (Btn2)</span>
              <div className={`w-12 h-12 rounded-full transition-all duration-200 ${sensor.btn2Debounced ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-gray-600'}`}></div>
            </div>
          </div>
          <div className="w-full py-2 mt-2 text-center rounded-md font-bold text-sm bg-slate-900 text-amber-400">
            Current Gauge: {sensor.current ? sensor.current.toFixed(2) : 0} mA
          </div>
        </div>
      </div>

      {/* ROW 2: LINE GRAPHS */}
      <div className="grid grid-cols-12 gap-4 mb-4">
        <div className={`col-span-12 md:col-span-6 p-4 rounded-lg shadow-md ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h3 className="text-md font-bold mb-3">Analog Line Graph (LDR, Voltage, Current)</h3>
          <div className="h-64">
            <Line
              data={{
                labels: analogHistory.map(h => h.time),
                datasets: [
                  { label: 'LDR Safe Scale', data: analogHistory.map(h => h.ldr), borderColor: '#f59e0b', tension: 0.3 },
                  { label: 'Voltage (V)', data: analogHistory.map(h => h.v), borderColor: '#3b82f6', tension: 0.3 },
                  { label: 'Current (mA)', data: analogHistory.map(h => h.i), borderColor: '#10b981', tension: 0.3 }
                ]
              }}
              options={{ responsive: true, maintainAspectRatio: false, animation: false }}
            />
          </div>
        </div>

        <div className={`col-span-12 md:col-span-6 p-4 rounded-lg shadow-md ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <h3 className="text-md font-bold mb-3">Digital Line Graph (Noise vs Debounce)</h3>
          <div className="h-64">
            <Line
              data={{
                labels: digitalHistory.map(h => h.time),
                datasets: [
                  { label: 'Btn1 Raw', data: digitalHistory.map(h => h.b1Raw), borderColor: '#ef4444', stepped: true },
                  { label: 'Btn1 Clean', data: digitalHistory.map(h => h.b1Clean), borderColor: '#10b981', stepped: true },
                  { label: 'Btn2 Raw', data: digitalHistory.map(h => h.b2Raw), borderColor: '#f97316', stepped: true },
                  { label: 'Btn2 Clean', data: digitalHistory.map(h => h.b2Clean), borderColor: '#06b6d4', stepped: true }
                ]
              }}
              options={{ responsive: true, maintainAspectRatio: false, animation: false }}
            />
          </div>
        </div>
      </div>

      {/* ROW 3: CONNECTION STATUS TABLE */}
      <div className={`p-4 rounded-lg shadow-md ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <h3 className="text-md font-bold mb-3">Tracing Realtime Table & Bandwidth</h3>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-700 text-sm font-semibold">
              <th className="p-3">Status</th>
              <th className="p-3">Bandwidth Rate</th>
              <th className="p-3">Active User</th>
              <th className="p-3">Last Update</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            <tr>
              <td className="p-3 font-bold">
                {isConnected && !signalLost ? (
                  <span className="text-green-500">🟢 Connected</span>
                ) : (
                  <span className="text-red-500">🔴 Signal Lost</span>
                )}
              </td>
              <td className="p-3">{bandwidth} Bytes / pkt</td>
              <td className="p-3 font-medium">{user ? user.username : 'Guest (Unknow)'}</td>
              <td className="p-3">{new Date().toLocaleTimeString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}