// ============================================================================
// File: frontend/src/App.jsx
// IoT Dashboard Frontend (React + Socket.IO + Chart.js + Tailwind CSS)
// ============================================================================
import React, { useState, useEffect } from 'react';
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

// ================= ANALOG NEEDLE GAUGE COMPONENT =================
/**
 * @brief คอมโพเนนต์เข็มไมล์จำลอง (Analog Gauge) สำหรับแสดงค่าแรงดันและความต้านทาน
 */
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
  const [alerts, setAlerts] = useState([]);

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

  // การรับฟังข้อมูล realtime ผ่าน Socket.IO
  useEffect(() => {
    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // รับข้อมูลอัปเดตจากเซนเซอร์
    socket.on('dashboard_update', (data) => {
      // 1. จำดัดค่า Resistance ไม่ให้เกิน 10,000 Ohm (10k)
      const rawResistance = data.resistance || 0;
      const clampedResistance = Math.min(Math.max(rawResistance, 0), 10000);

      const updatedSensorData = {
        ...data,
        resistance: clampedResistance
      };

      setSensor(updatedSensorData);
      const timeStr = new Date().toLocaleTimeString();
      setBandwidth(JSON.stringify(data).length);

      setAnalogHistory(prev => [
        ...prev.slice(-19),
        { 
          time: timeStr, 
          ldr: data.ldr || 0, 
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

    // รับการแจ้งเตือนจากระบบ Alert
    socket.on('sensor_alert', (alertData) => {
      setAlerts(prev => [alertData, ...prev.slice(0, 9)]);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('dashboard_update');
      socket.off('sensor_alert');
    };
  }, []);

  // ฟังก์ชันล้างค่าการแจ้งเตือน (Clear Alerts)
  const handleClearAlerts = () => {
    setAlerts([]);
  };

  // ระบบเข้าสู่ระบบ / ลงทะเบียน
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
      
      {/* HEADER BAR */}
      <div className={`flex flex-wrap justify-between items-center p-4 rounded-lg shadow-md mb-4 ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <h1 className="text-xl font-bold">My Dashboard (WiFi Mode)</h1>
        
        <div className="flex items-center gap-3">
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

      {/* ALERT NOTIFICATION PANEL WITH CLEAR BUTTON */}
      {alerts.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-bold text-gray-400">System Alerts ({alerts.length})</span>
            <button
              onClick={handleClearAlerts}
              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold shadow transition-colors"
            >
              🗑️ Clear Alerts
            </button>
          </div>
          {alerts.map((al, idx) => (
            <div key={idx} className={`p-3 rounded-md text-sm font-semibold flex justify-between items-center ${
              al.type === 'CRITICAL' ? 'bg-red-600 text-white' : al.type === 'WARNING' ? 'bg-amber-500 text-slate-950' : 'bg-blue-600 text-white'
            }`}>
              <span>🚨 [{al.type || 'INFO'}] {al.message}</span>
              <span className="text-xs opacity-80">{al.timestamp ? new Date(al.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()}</span>
            </div>
          ))}
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
                  { label: 'LDR Raw', data: analogHistory.map(h => h.ldr), borderColor: '#f59e0b', tension: 0.3 },
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
                {isConnected ? <span className="text-green-500">🟢 Connected</span> : <span className="text-red-500">🔴 Disconnected</span>}
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