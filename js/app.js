/**
 * ============================================================
 * SMART ENVIRONMENTAL MONITORING SYSTEM - WEB APPLICATION ENGINE
 * Client-Side Orchestrator, Chart.js Visualizer & Weather Fusion
 * Author: Ankit Satnami | GitHub: @Ankitsatnami
 * ============================================================
 */

// Application State
const AppState = {
  isSimulation: false,      // STRICTLY OPTIONAL - OFF by default
  apiEndpoint: '/api/data', // Relative for ESP32 host, configurable for custom IP
  tempUnit: 'C',
  audioBuzzerEnabled: false,
  lastSensorData: null,
  lastWeatherData: null,
  chartHistoryLimit: 40,
  telemetryLogs: [],
  simulated: {
    temp: 26.5,
    humidity: 58.0,
    soilRaw: 2150,
    soilMoisture: 52,
    rainRaw: 3800,
    raining: false,
    dhtValid: true,
    buzzer: false
  }
};

// ============================================================
// OFFICIAL ESP32 FIRMWARE SOURCE CODE (EMBEDDED FOR DOWNLOAD & COPY)
// ============================================================
const ESP32_FIRMWARE_CODE = `/*
  ============================================================
       SMART ENVIRONMENTAL MONITORING SYSTEM
       ESP32 + DHT11 + SOIL MOISTURE + RAIN SENSOR
       LIVE WEATHER + SMART ENVIRONMENTAL ADVISOR
  ============================================================

  BOARD: ESP32 DevKit V1
  AUTHOR: Ankit Satnami
  GITHUB: https://github.com/Ankitsatnami/Smart_Environment_Monitor

  HARDWARE CONNECTIONS:
  ------------------------------------------------------------
  DHT11 DATA       -> GPIO 4   (Requires 4.7k - 10k pull-up resistor to 3.3V)
  SOIL SENSOR AO   -> GPIO 34  (Analog Input, ADC1_CH6)
  RAIN SENSOR AO   -> GPIO 35  (Analog Input, ADC1_CH7)
  ACTIVE BUZZER +  -> GPIO 26  (Digital Output)
  VCC / 3V3 / 5V   -> Respective Power Rails
  ALL GND          -> ESP32 Common Ground (GND)

  FEATURES:
  - High-frequency sensor acquisition with 10-sample ADC oversampling
  - Non-blocking asynchronous timing loop
  - Embedded high-performance Web Dashboard (Chart.js + Open-Meteo)
  - RESTful JSON API (/api/data) with full Cross-Origin Resource Sharing (CORS)
  - Automatic Pluviometric Audio Alert Buzzer
  - Watchdog and automatic Wi-Fi auto-reconnect engine
  ============================================================
*/

#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>

// ============================================================
// 1. WI-FI CONFIGURATION
// ============================================================

const char* WIFI_SSID     = "Ankit";
const char* WIFI_PASSWORD = "12345678";

// ============================================================
// 2. PIN DEFINITIONS & ATTENUATION
// ============================================================

#define DHT_PIN       4
#define DHT_TYPE      DHT11

#define SOIL_PIN      34
#define RAIN_PIN      35

#define BUZZER_PIN    26

DHT dht(DHT_PIN, DHT_TYPE);
WebServer server(80);

// ============================================================
// 3. SENSOR CALIBRATION PARAMETERS
// ============================================================

// 12-bit ADC full-scale ranges from 0 to 4095
int SOIL_DRY_VALUE     = 3000; // Dry air benchmark count
int SOIL_WET_VALUE     = 1300; // Submerged water benchmark count

// Rain module: Inverted conductive drop (lower voltage = higher moisture)
int RAIN_WET_THRESHOLD = 2500; // Activation threshold for buzzer

// ============================================================
// 4. GLOBAL TELEMETRY VARIABLES
// ============================================================

float temperature   = 0.0;
float humidity      = 0.0;
int   soilRaw       = 0;
int   soilMoisture  = 0;
int   rainRaw       = 0;
bool  raining       = false;
bool  dhtValid      = false;

unsigned long lastSensorRead = 0;
unsigned long lastWiFiCheck  = 0;
const unsigned long SENSOR_INTERVAL = 2500; // 2.5 seconds refresh

// ============================================================
// 5. EMBEDDED DASHBOARD (PROGMEM)
// ============================================================

const char webpage[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Environment | IoT Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
:root{--bg:#080f1d;--sidebar:#0d1728;--card:#121f33;--card2:#192942;--border:#263952;--text:#eef4ff;--muted:#91a2bc;--blue:#56a9ff;--green:#4ed6a0;--orange:#ffad70;--red:#ff6876;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:Arial,sans-serif;}
.layout{display:flex;min-height:100vh;}
.sidebar{width:245px;background:var(--sidebar);border-right:1px solid var(--border);padding:25px 18px;position:fixed;height:100vh;}
.brand{font-size:19px;font-weight:bold;margin-bottom:7px;}
.brand span{color:var(--green);}
.brand-sub{font-size:11px;color:var(--muted);letter-spacing:1px;margin-bottom:40px;}
.nav-title{color:#657894;font-size:10px;letter-spacing:1.5px;margin:20px 10px 12px;}
.nav-item{display:block;padding:13px;margin-bottom:7px;border-radius:9px;color:var(--muted);text-decoration:none;font-size:13px;}
.nav-item.active,.nav-item:hover{background:#1c3551;color:white;}
.main{margin-left:245px;width:calc(100% - 245px);padding:28px 35px;max-width:1600px;}
.header{display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;margin-bottom:30px;}
.header h1{font-size:25px;margin-bottom:7px;}
.header p{color:var(--muted);font-size:13px;}
.online{padding:10px 15px;border-radius:30px;background:#153b30;color:#65e4aa;font-size:12px;}
.section{margin-top:30px;scroll-margin-top:20px;}
.section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:17px;}
.section-heading h2{font-size:17px;}
.section-heading small{color:var(--muted);font-size:11px;}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:17px;}
.card{background:var(--card);border:1px solid var(--border);border-radius:13px;padding:20px;min-width:0;}
.card-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
.card-label{color:var(--muted);font-size:12px;}
.card-icon{width:37px;height:37px;border-radius:10px;display:grid;place-items:center;font-size:19px;background:var(--card2);}
.card-value{font-size:29px;font-weight:bold;margin-bottom:8px;overflow-wrap:anywhere;}
.card-description{color:var(--muted);font-size:11px;}
.accent-blue{color:var(--blue);}.accent-green{color:var(--green);}.accent-orange{color:var(--orange);}.accent-red{color:var(--red);}
.panel{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px;min-width:0;}
.panel h3{font-size:15px;margin-bottom:8px;}
.panel-sub{font-size:11px;color:var(--muted);margin-bottom:20px;}
.two-columns{display:grid;grid-template-columns:1fr 1fr;gap:17px;}
.chart-wrap{height:260px;position:relative;}
.weather-hero{background:linear-gradient(115deg,#173654,#14263d);border:1px solid #315474;border-radius:14px;padding:23px;margin-bottom:17px;}
.weather-main{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;}
.weather-temp{font-size:45px;font-weight:bold;margin:10px 0;}
.weather-location{color:#bdd0e5;font-size:12px;}
.weather-condition{color:#c4d8ee;font-size:13px;}
.weather-details{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:23px;}
.weather-detail{background:rgba(255,255,255,0.06);border-radius:9px;padding:14px;}
.weather-detail small{color:#b2c7df;font-size:10px;}
.weather-detail div{font-size:20px;margin-top:9px;font-weight:bold;}
.forecast-row{display:flex;overflow-x:auto;gap:12px;padding:5px 0 12px;}
.forecast-item{background:var(--card2);border:1px solid var(--border);border-radius:10px;min-width:110px;padding:15px 12px;text-align:center;}
.forecast-item small{color:var(--muted);font-size:11px;}
.forecast-item h3{margin:12px 0;font-size:21px;}
.forecast-item p{font-size:11px;color:var(--muted);margin-top:7px;}
.week-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;}
.week-item{background:var(--card2);border-radius:10px;padding:13px 8px;text-align:center;}
.week-item small{color:var(--muted);font-size:10px;}
.week-item h3{font-size:19px;margin:12px 0;}
.week-item p{font-size:10px;color:var(--muted);margin-top:7px;}
.action-btn{background:#267bd1;color:white;border:0;border-radius:8px;padding:11px 16px;cursor:pointer;font-size:12px;}
.action-btn:hover{background:#368ee9;}
.suggestion-list{display:grid;gap:12px;}
.suggestion{padding:15px;background:#1a3042;border:1px solid #28445a;border-left:4px solid var(--green);border-radius:9px;font-size:12px;line-height:1.7;}
.suggestion.warning{border-left-color:var(--orange);}
.suggestion.danger{border-left-color:var(--red);}
.status-row{display:flex;justify-content:space-between;gap:10px;padding:13px 0;border-bottom:1px solid var(--border);font-size:12px;}
.status-row:last-child{border:none;}
.status-row span{color:var(--muted);}
.footer{text-align:center;color:#687e9a;font-size:11px;margin-top:40px;padding:20px;}
@media(max-width:1100px){.grid{grid-template-columns:repeat(2,1fr);}.week-grid{grid-template-columns:repeat(4,1fr);}}
@media(max-width:750px){.sidebar{display:none;}.main{margin-left:0;width:100%;padding:20px 15px;}.two-columns{grid-template-columns:1fr;}.weather-details{grid-template-columns:repeat(2,1fr);}.week-grid{grid-template-columns:repeat(2,1fr);}.header h1{font-size:21px;}}
@media(max-width:400px){.grid{grid-template-columns:1fr 1fr;gap:9px;}.card{padding:13px;}.card-value{font-size:23px;}}
</style>
</head>
<body>
<div class="layout">
<aside class="sidebar">
  <div class="brand">🌿 SMART<span>ENV</span></div>
  <div class="brand-sub">ENVIRONMENTAL INTELLIGENCE</div>
  <div class="nav-title">MAIN MENU</div>
  <a href="#overview" class="nav-item active">◈ &nbsp; Overview</a>
  <a href="#sensors" class="nav-item">◉ &nbsp; Sensor Monitoring</a>
  <a href="#weather" class="nav-item">☀ &nbsp; Live Weather</a>
  <a href="#analytics" class="nav-item">▥ &nbsp; Analytics</a>
  <a href="#advisor" class="nav-item">✧ &nbsp; Smart Advisor</a>
  <div class="nav-title">SYSTEM</div>
  <a href="#system" class="nav-item">⚙ &nbsp; Device Status</a>
</aside>
<main class="main">
<header class="header" id="overview">
  <div>
    <h1>Environmental Dashboard</h1>
    <p>Real-time environmental monitoring and intelligence · By Ankit Satnami</p>
  </div>
  <div class="online" id="connectionStatus">● ESP32 CONNECTING</div>
</header>
<section class="section" id="sensors">
  <div class="section-heading"><h2>Environmental Sensors</h2><small>ESP32 LIVE DATA</small></div>
  <div class="grid">
    <div class="card"><div class="card-top"><span class="card-label">TEMPERATURE</span><div class="card-icon">🌡️</div></div><div class="card-value accent-orange" id="temp">-- °C</div><div class="card-description">DHT11 · Ambient temperature</div></div>
    <div class="card"><div class="card-top"><span class="card-label">HUMIDITY</span><div class="card-icon">💧</div></div><div class="card-value accent-blue" id="humidity">-- %</div><div class="card-description">DHT11 · Relative humidity</div></div>
    <div class="card"><div class="card-top"><span class="card-label">SOIL MOISTURE</span><div class="card-icon">🌱</div></div><div class="card-value accent-green" id="soil">-- %</div><div class="card-description" id="soilStatus">Waiting for sensor</div></div>
    <div class="card"><div class="card-top"><span class="card-label">RAIN DETECTION</span><div class="card-icon">🌧️</div></div><div class="card-value accent-blue" id="rain">--</div><div class="card-description" id="rainStatus">Waiting for sensor</div></div>
  </div>
</section>
<section class="section" id="weather">
  <div class="section-heading">
    <div><h2>Live Weather & Forecast</h2><small>LOCATION BASED WEATHER INTELLIGENCE</small></div>
    <button class="action-btn" id="refreshWeatherBtn" type="button">↻ Refresh Weather</button>
  </div>
  <div class="weather-hero">
    <div class="weather-main">
      <div>
        <div class="weather-location" id="weatherLocation">Detecting location...</div>
        <div class="weather-temp" id="outTemp">--°C</div>
        <div class="weather-condition" id="weatherCondition">Loading weather...</div>
      </div>
      <div style="font-size:65px" id="weatherIcon">🌤️</div>
    </div>
    <div class="weather-details">
      <div class="weather-detail"><small>FEELS LIKE</small><div id="feelsLike">--°C</div></div>
      <div class="weather-detail"><small>HUMIDITY</small><div id="outHumidity">--%</div></div>
      <div class="weather-detail"><small>WIND SPEED</small><div id="windSpeed">-- km/h</div></div>
      <div class="weather-detail"><small>PRECIPITATION</small><div id="precipitation">-- mm</div></div>
    </div>
  </div>
  <div class="panel"><h3>Next 24 Hours</h3><p class="panel-sub">Hourly temperature and rain probability</p><div class="forecast-row" id="hourlyForecast"><p>Loading...</p></div></div>
  <div class="panel" style="margin-top:17px"><h3>7-Day Weather Forecast</h3><p class="panel-sub">Daily temperature and precipitation probability</p><div class="week-grid" id="weeklyForecast"><p>Loading...</p></div></div>
  <div class="panel" style="margin-top:17px"><h3>Weather Forecast Analytics</h3><p class="panel-sub">Next 24 hours · Temperature and rain probability</p><div class="chart-wrap"><canvas id="weatherChart"></canvas></div></div>
  <p id="weatherUpdated" style="color:var(--muted);font-size:11px;margin-top:12px">Weather data loading...</p>
</section>
<section class="section" id="analytics">
  <div class="section-heading"><h2>Sensor Analytics</h2><small>LIVE HISTORICAL READINGS</small></div>
  <div class="two-columns">
    <div class="panel"><h3>Temperature & Humidity</h3><p class="panel-sub">DHT11 readings over time</p><div class="chart-wrap"><canvas id="climateChart"></canvas></div></div>
    <div class="panel"><h3>Soil Moisture History</h3><p class="panel-sub">Soil moisture variation</p><div class="chart-wrap"><canvas id="soilChart"></canvas></div></div>
  </div>
</section>
<section class="section" id="advisor">
  <div class="section-heading"><h2>Smart Environmental Advisor</h2><small>COMBINED SENSOR + WEATHER ANALYSIS</small></div>
  <div class="panel"><h3>✧ Environmental Recommendations</h3><p class="panel-sub">Generated using sensor readings and upcoming weather.</p><div class="suggestion-list" id="suggestions"><div class="suggestion">Analyzing environmental conditions...</div></div></div>
</section>
<section class="section" id="system">
  <div class="section-heading"><h2>System Information</h2></div>
  <div class="panel">
    <div class="status-row"><span>ESP32 Connection</span><b id="deviceStatus">Connecting...</b></div>
    <div class="status-row"><span>DHT11 Sensor</span><b id="dhtStatus">Waiting</b></div>
    <div class="status-row"><span>Rain Alert Buzzer</span><b id="buzzerStatus">OFF</b></div>
    <div class="status-row"><span>Soil Raw Value</span><b id="soilRaw">--</b></div>
    <div class="status-row"><span>Rain Raw Value</span><b id="rainRaw">--</b></div>
    <div class="status-row"><span>Last Sensor Update</span><b id="lastUpdate">--</b></div>
  </div>
</section>
<footer class="footer">
  SMART ENVIRONMENTAL MONITORING SYSTEM<br><br>
  Designed & Developed by <a href="https://github.com/Ankitsatnami" style="color:#56a9ff;">Ankit Satnami</a> · Powered by ESP32 & Open-Meteo
</footer>
</main>
</div>
<script>
const chartOptions={responsive:true,maintainAspectRatio:false,animation:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{labels:{color:'#b9c9dc'}}},scales:{x:{ticks:{color:'#91a2bc'},grid:{color:'#263952'}},y:{ticks:{color:'#91a2bc'},grid:{color:'#263952'}}}};
const climateChart=new Chart(document.getElementById('climateChart'),{type:'line',data:{labels:[],datasets:[{label:'Temperature °C',data:[],borderColor:'#ffad70',backgroundColor:'rgba(255,173,112,0.1)',tension:0.35},{label:'Humidity %',data:[],borderColor:'#56a9ff',backgroundColor:'rgba(86,169,255,0.1)',tension:0.35}]},options:chartOptions});
const soilChart=new Chart(document.getElementById('soilChart'),{type:'line',data:{labels:[],datasets:[{label:'Soil Moisture %',data:[],borderColor:'#4ed6a0',backgroundColor:'rgba(78,214,160,0.12)',fill:true,tension:0.35}]},options:chartOptions});
const weatherChart=new Chart(document.getElementById('weatherChart'),{type:'line',data:{labels:[],datasets:[{label:'Temperature °C',data:[],borderColor:'#ffad70',tension:0.35,yAxisID:'y'},{label:'Rain Probability %',data:[],borderColor:'#56a9ff',tension:0.35,yAxisID:'y1'}]},options:{...chartOptions,scales:{x:{ticks:{color:'#91a2bc'},grid:{color:'#263952'}},y:{position:'left',ticks:{color:'#ffad70'},grid:{color:'#263952'}},y1:{position:'right',min:0,max:100,ticks:{color:'#56a9ff'},grid:{drawOnChartArea:false}}}}});
function addPoint(chart,label,values){chart.data.labels.push(label);values.forEach((v,i)=>{chart.data.datasets[i].data.push(v);});if(chart.data.labels.length>40){chart.data.labels.shift();chart.data.datasets.forEach(d=>{d.data.shift();});}chart.update('none');}
let latestSensorData=null,latestWeather=null;
async function updateDashboard(){try{const response=await fetch('/api/data');if(!response.ok)throw new Error('ESP32 error');const d=await response.json();latestSensorData=d;document.getElementById('connectionStatus').textContent='● ESP32 ONLINE';document.getElementById('deviceStatus').textContent='CONNECTED';if(d.dhtValid){document.getElementById('temp').textContent=d.temperature.toFixed(1)+' °C';document.getElementById('humidity').textContent=d.humidity.toFixed(1)+' %';document.getElementById('dhtStatus').textContent='WORKING';addPoint(climateChart,new Date().toLocaleTimeString(),[d.temperature,d.humidity]);}else{document.getElementById('temp').textContent='-- °C';document.getElementById('humidity').textContent='-- %';document.getElementById('dhtStatus').textContent='SENSOR ERROR';}document.getElementById('soil').textContent=d.soilMoisture+' %';document.getElementById('soilStatus').textContent=d.soilMoisture<30?'Dry soil':d.soilMoisture<60?'Moderate moisture':'Wet soil';document.getElementById('rain').textContent=d.raining?'RAIN':'CLEAR';document.getElementById('rainStatus').textContent=d.raining?'Rain detected':'No rain detected';document.getElementById('buzzerStatus').textContent=d.raining?'ON - RAIN ALERT':'OFF';document.getElementById('soilRaw').textContent=d.soilRaw;document.getElementById('rainRaw').textContent=d.rainRaw;document.getElementById('lastUpdate').textContent=new Date().toLocaleTimeString();addPoint(soilChart,new Date().toLocaleTimeString(),[d.soilMoisture]);renderAdvisor();}catch(e){document.getElementById('connectionStatus').textContent='● ESP32 OFFLINE';document.getElementById('deviceStatus').textContent='DISCONNECTED';}}
function weatherDescription(c){const d={0:'Clear Sky',1:'Mainly Clear',2:'Partly Cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Light Drizzle',53:'Moderate Drizzle',55:'Heavy Drizzle',61:'Light Rain',63:'Moderate Rain',65:'Heavy Rain',71:'Light Snow',73:'Moderate Snow',75:'Heavy Snow',80:'Rain Showers',81:'Moderate Showers',82:'Heavy Showers',95:'Thunderstorm',96:'Thunderstorm with Hail',99:'Severe Thunderstorm'};return d[c]||'Variable Weather';}
function weatherEmoji(c){if(c===0)return'☀️';if(c<=2)return'🌤️';if(c===3)return'☁️';if(c===45||c===48)return'🌫️';if(c>=51&&c<=67)return'🌧️';if(c>=71&&c<=77)return'❄️';if(c>=80&&c<=82)return'🌦️';if(c>=95)return'⛈️';return'🌤️';}
async function getLocation(){if(navigator.geolocation){try{const p=await new Promise((res,rej)=>{navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:false,timeout:8000,maximumAge:600000});});return{lat:p.coords.latitude,lon:p.coords.longitude,name:'GPS Location'};}catch(e){}}const r=await fetch('https://ipapi.co/json/');const l=await r.json();return{lat:l.latitude,lon:l.longitude,name:[l.city,l.region].filter(Boolean).join(', ')};}
async function getWeather(){const locElem=document.getElementById('weatherLocation');try{const loc=await getLocation();const url=\`https://api.open-meteo.com/v1/forecast?latitude=\${loc.lat}&longitude=\${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=auto\`;const r=await fetch(url);const data=await r.json();latestWeather=data;locElem.textContent='📍 '+loc.name+' ('+loc.lat.toFixed(2)+', '+loc.lon.toFixed(2)+')';const c=data.current;document.getElementById('outTemp').textContent=c.temperature_2m+'°C';document.getElementById('feelsLike').textContent=c.apparent_temperature+'°C';document.getElementById('outHumidity').textContent=c.relative_humidity_2m+'%';document.getElementById('windSpeed').textContent=c.wind_speed_10m+' km/h';document.getElementById('precipitation').textContent=c.precipitation+' mm';document.getElementById('weatherCondition').textContent=weatherDescription(c.weather_code);document.getElementById('weatherIcon').textContent=weatherEmoji(c.weather_code);const hourly=data.hourly;const hBox=document.getElementById('hourlyForecast');hBox.innerHTML='';const now=new Date(c.time).getTime();let sIdx=hourly.time.findIndex(t=>new Date(t).getTime()>=now);if(sIdx<0)sIdx=0;for(let i=sIdx;i<Math.min(sIdx+24,hourly.time.length);i++){const item=document.createElement('div');item.className='forecast-item';item.innerHTML=\`<small>\${new Date(hourly.time[i]).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small><div style="font-size:24px;margin:10px 0">\${weatherEmoji(hourly.weather_code[i])}</div><h3>\${hourly.temperature_2m[i]}°</h3><p>Rain \${hourly.precipitation_probability[i]}%</p>\`;hBox.appendChild(item);}const daily=data.daily;const wBox=document.getElementById('weeklyForecast');wBox.innerHTML='';for(let i=0;i<7;i++){const item=document.createElement('div');item.className='week-item';item.innerHTML=\`<small>\${new Date(daily.time[i]+'T12:00:00').toLocaleDateString([],{weekday:'short'})}</small><div style="font-size:23px;margin:9px 0">\${weatherEmoji(daily.weather_code[i])}</div><h3>\${daily.temperature_2m_max[i]}°</h3><p>Min \${daily.temperature_2m_min[i]}°</p><p>Rain \${daily.precipitation_probability_max[i]}%</p>\`;wBox.appendChild(item);}weatherChart.data.labels=[];weatherChart.data.datasets[0].data=[];weatherChart.data.datasets[1].data=[];for(let i=sIdx;i<Math.min(sIdx+24,hourly.time.length);i++){weatherChart.data.labels.push(new Date(hourly.time[i]).toLocaleTimeString([],{hour:'2-digit'}));weatherChart.data.datasets[0].data.push(hourly.temperature_2m[i]);weatherChart.data.datasets[1].data.push(hourly.precipitation_probability[i]);}weatherChart.update('none');document.getElementById('weatherUpdated').textContent='Updated: '+new Date().toLocaleTimeString()+' | Open-Meteo';renderAdvisor();}catch(e){locElem.textContent='Weather Error: '+e.message;}}
document.getElementById('refreshWeatherBtn').addEventListener('click',getWeather);
function renderAdvisor(){const box=document.getElementById('suggestions');box.innerHTML='';let s=[];const d=latestSensorData,w=latestWeather;if(!d)return;function add(t,l='normal'){s.push({t,l});}if(!d.dhtValid)add('DHT11 sensor offline. Inspect GPIO 4.','danger');else{if(d.temperature>35)add('High ambient temperature. Provide shading curtains.','danger');else if(d.temperature<15)add('Low temperature inversion. Protect sensitive vegetation.','warning');if(d.humidity>85)add('High humidity detected. Ventilate to mitigate fungal infection.','warning');}if(d.soilMoisture<25)add('Soil is severely parched. Drip irrigation required.','danger');else if(d.soilMoisture>80)add('Soil is saturated. Cease irrigation.','warning');if(d.raining)add('Active rain detected. Outdoor relays isolated.','warning');if(w){const rainChance=Math.max(...w.daily.precipitation_probability_max.slice(0,2));if(rainChance>=70&&d.soilMoisture>35)add('High rain probability predicted within 48h. Conserve water and suspend irrigation.','warning');}if(s.length===0)add('Environmental boundary conditions are within optimal agronomic parameters.','normal');s.forEach(item=>{const div=document.createElement('div');div.className='suggestion '+item.l;div.textContent='✧ '+item.t;box.appendChild(div);});}
updateDashboard();getWeather();setInterval(updateDashboard,2500);setInterval(getWeather,600000);
</script>
</body>
</html>
)rawliteral";

// ============================================================
// 6. SENSOR MEASUREMENT & 10-SAMPLE OVERSAMPLING
// ============================================================

void readSensors() {
  // Read Digital Temperature & Relative Humidity from DHT11
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if(!isnan(t) && !isnan(h)) {
    temperature = t;
    humidity    = h;
    dhtValid    = true;
  } else {
    dhtValid    = false;
  }

  // 10-sample ADC oversampling for noise rejection
  long soilSum = 0;
  long rainSum = 0;

  for(int i = 0; i < 10; i++) {
    soilSum += analogRead(SOIL_PIN);
    rainSum += analogRead(RAIN_PIN);
    delay(2);
  }

  soilRaw = soilSum / 10;
  rainRaw = rainSum / 10;

  // Calibrate and map volumetric soil moisture percentage
  soilMoisture = map(soilRaw, SOIL_DRY_VALUE, SOIL_WET_VALUE, 0, 100);
  soilMoisture = constrain(soilMoisture, 0, 100);

  // Precipitation detection
  raining = (rainRaw < RAIN_WET_THRESHOLD);

  // Automatic Audio Alert Buzzer
  digitalWrite(BUZZER_PIN, raining ? HIGH : LOW);
}

// ============================================================
// 7. MACRO-ENVIRONMENT ASSESSMENT
// ============================================================

String getEnvironment() {
  if(!dhtValid)                         return "DHT_FAULT";
  if(raining && soilMoisture > 70)       return "RAINY_AND_SATURATED";
  if(raining)                           return "ACTIVE_PRECIPITATION";
  if(temperature > 35 && soilMoisture < 30) return "HEAT_STRESS_ARID";
  if(temperature > 32 && humidity > 75) return "TROPICAL_HUMID_HEAT";
  if(soilMoisture < 25)                 return "SOIL_MOISTURE_DEFICIT";
  if(humidity > 85)                     return "HIGH_PATHOGENIC_HUMIDITY";
  if(temperature < 15)                  return "COLD_MICROCLIMATE";
  return "OPTIMAL_HOMEOSTASIS";
}

// ============================================================
// 8. RESTFUL JSON TELEMETRY API (/api/data)
// ============================================================

void handleData() {
  String json = "{";
  json += "\\"temperature\\":"   + String(temperature, 1) + ",";
  json += "\\"humidity\\":"      + String(humidity, 1) + ",";
  json += "\\"soilRaw\\":"       + String(soilRaw) + ",";
  json += "\\"rainRaw\\":"       + String(rainRaw) + ",";
  json += "\\"soilMoisture\\":"  + String(soilMoisture) + ",";
  json += "\\"raining\\":"       + String(raining ? "true" : "false") + ",";
  json += "\\"dhtValid\\":"      + String(dhtValid ? "true" : "false") + ",";
  json += "\\"environment\\":\\"" + getEnvironment() + "\\"";
  json += "}";

  // Enable CORS headers so GitHub Pages & external dashboards can query local ESP32
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  server.send(200, "application/json", json);
}

// ============================================================
// 9. SYSTEM SETUP & PERIPHERAL INITIALIZATION
// ============================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\\n==============================================");
  Serial.println(" SMART ENVIRONMENTAL MONITORING SYSTEM");
  Serial.println(" Developed by Ankit Satnami");
  Serial.println("==============================================");

  // Digital Output Configuration
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // 12-Bit ADC Resolution & 11dB Input Attenuation (0 - 3.3V)
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);
  analogSetPinAttenuation(RAIN_PIN, ADC_11db);

  // Initialize DHT11 sensor bus
  dht.begin();

  // Connect to Local Wi-Fi Network
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to Wi-Fi SSID [");
  Serial.print(WIFI_SSID);
  Serial.print("]");

  unsigned long startAttempt = millis();
  while(WiFi.status() != WL_CONNECTED && (millis() - startAttempt < 20000)) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if(WiFi.status() == WL_CONNECTED) {
    Serial.println(">>> Wi-Fi Connected Successfully!");
    Serial.print(">>> IP Address: http://");
    Serial.println(WiFi.localIP());
    Serial.print(">>> API URL:    http://");
    Serial.print(WiFi.localIP());
    Serial.println("/api/data");
  } else {
    Serial.println(">>> Wi-Fi connection timed out. Check credentials.");
  }

  // Web Server Routing
  server.on("/", HTTP_GET, []() {
    server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    server.send_P(200, "text/html", webpage);
  });

  server.on("/api/data", HTTP_GET, handleData);

  server.onNotFound([]() {
    server.send(404, "text/plain", "Resource Not Found on ESP32 Micro-Server");
  });

  server.begin();
  Serial.println(">>> Micro-Web Server Listening on Port 80");

  // Initial Sensor Sampling
  readSensors();
  lastSensorRead = millis();
  lastWiFiCheck  = millis();

  Serial.println(">>> System Ready & Operational.");
}

// ============================================================
// 10. MAIN NON-BLOCKING EXECUTION LOOP
// ============================================================

void loop() {
  // Service incoming HTTP requests
  server.handleClient();

  // Periodic Telemetry Acquisition
  if(millis() - lastSensorRead >= SENSOR_INTERVAL) {
    lastSensorRead = millis();
    readSensors();

    Serial.println("\\n--- [TELEMETRY UPDATE] ---");
    Serial.printf("Temp: %.1f C | Hum: %.1f %% | Soil: %d %% (Raw: %d) | Rain: %s (Raw: %d)\\n",
                  temperature, humidity, soilMoisture, soilRaw,
                  raining ? "DETECTED" : "CLEAR", rainRaw);
    Serial.println("State: " + getEnvironment());
  }

  // Wi-Fi Connection Watchdog (every 10 seconds)
  if(millis() - lastWiFiCheck >= 10000) {
    lastWiFiCheck = millis();
    if(WiFi.status() != WL_CONNECTED) {
      Serial.println("Wi-Fi link lost. Attempting auto-reconnect...");
      WiFi.reconnect();
    }
  }
}`;

// ============================================================
// 1. CHART INITIALIZATION
// ============================================================

const chartBaseOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: {
    intersect: false,
    mode: 'index'
  },
  plugins: {
    legend: {
      position: 'top',
      labels: {
        color: '#8fa2bd',
        font: { family: 'Inter', size: 11, weight: '500' },
        boxWidth: 12,
        padding: 14
      }
    },
    tooltip: {
      backgroundColor: '#0d1728',
      titleColor: '#edf2f9',
      bodyColor: '#8fa2bd',
      borderColor: '#22354c',
      borderWidth: 1,
      padding: 10
    }
  },
  scales: {
    x: {
      ticks: { color: '#5c708a', font: { family: 'JetBrains Mono', size: 10 } },
      grid: { color: 'rgba(34, 53, 76, 0.5)' }
    },
    y: {
      ticks: { color: '#5c708a', font: { family: 'JetBrains Mono', size: 10 } },
      grid: { color: 'rgba(34, 53, 76, 0.5)' }
    }
  }
};

let climateChart = null;
let soilChart = null;
let weatherChart = null;

function initCharts() {
  const ctxClimate = document.getElementById('climateChart');
  if (ctxClimate) {
    climateChart = new Chart(ctxClimate, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Temperature (°C)',
            data: [],
            borderColor: '#ffa868',
            backgroundColor: 'rgba(255, 168, 104, 0.08)',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 4
          },
          {
            label: 'Humidity (%)',
            data: [],
            borderColor: '#54a5ff',
            backgroundColor: 'rgba(84, 165, 255, 0.08)',
            borderWidth: 2,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 4
          }
        ]
      },
      options: chartBaseOptions
    });
  }

  const ctxSoil = document.getElementById('soilChart');
  if (ctxSoil) {
    soilChart = new Chart(ctxSoil, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Soil Moisture (%)',
            data: [],
            borderColor: '#48d698',
            backgroundColor: 'rgba(72, 214, 152, 0.12)',
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 4
          }
        ]
      },
      options: chartBaseOptions
    });
  }

  const ctxWeather = document.getElementById('weatherChart');
  if (ctxWeather) {
    weatherChart = new Chart(ctxWeather, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Forecast Temp (°C)',
            data: [],
            borderColor: '#ffa868',
            backgroundColor: 'rgba(255, 168, 104, 0.1)',
            borderWidth: 2,
            tension: 0.35,
            yAxisID: 'y'
          },
          {
            label: 'Rain Probability (%)',
            data: [],
            borderColor: '#54a5ff',
            backgroundColor: 'rgba(84, 165, 255, 0.15)',
            borderWidth: 2,
            fill: true,
            tension: 0.35,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        ...chartBaseOptions,
        scales: {
          x: {
            ticks: { color: '#5c708a', font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: 'rgba(34, 53, 76, 0.5)' }
          },
          y: {
            position: 'left',
            ticks: { color: '#ffa868', font: { family: 'JetBrains Mono', size: 10 } },
            grid: { color: 'rgba(34, 53, 76, 0.5)' }
          },
          y1: {
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#54a5ff', font: { family: 'JetBrains Mono', size: 10 } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }
}

function pushChartPoint(chart, label, values) {
  if (!chart) return;
  chart.data.labels.push(label);
  values.forEach((val, idx) => {
    if (chart.data.datasets[idx]) {
      chart.data.datasets[idx].data.push(val);
    }
  });

  if (chart.data.labels.length > AppState.chartHistoryLimit) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(ds => ds.data.shift());
  }
  chart.update('none');
}

// ============================================================
// 2. AUDIO BUZZER SYNTHESIZER
// ============================================================

let audioCtx = null;
function playBuzzerAlert() {
  if (!AppState.audioBuzzerEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 tone
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (err) {
    console.warn('Audio buzzer synth error:', err);
  }
}

// ============================================================
// 3. SENSOR TELEMETRY & ADVISOR LOGIC
// ============================================================

async function fetchSensorTelemetry() {
  // If user activated simulation, run simulation tick
  if (AppState.isSimulation) {
    simulateTelemetryTick();
    return;
  }

  // Otherwise, strictly query live ESP32 hardware
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2200);

    const response = await fetch(AppState.apiEndpoint, {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('ESP32 HTTP ' + response.status);

    const data = await response.json();
    renderSensorTelemetry(data, false);
  } catch (error) {
    // DO NOT automatically switch to simulation! Simulation is strictly optional!
    renderOfflineState();
  }
}

function renderOfflineState() {
  const statusBadge = document.getElementById('connectionStatus');
  const deviceStatusText = document.getElementById('deviceStatus');
  if (statusBadge) {
    statusBadge.className = 'badge-mode badge-offline';
    statusBadge.innerHTML = '<span class="status-dot"></span> ESP32 OFFLINE';
  }
  if (deviceStatusText) {
    deviceStatusText.textContent = 'DISCONNECTED (Click "Run Simulation" to bench-test)';
    deviceStatusText.style.color = 'var(--red)';
  }

  const tempVal = document.getElementById('temp');
  const humVal = document.getElementById('humidity');
  const dhtStatus = document.getElementById('dhtStatus');
  if (tempVal) tempVal.textContent = '-- °C';
  if (humVal) humVal.textContent = '-- %';
  if (dhtStatus) {
    dhtStatus.textContent = 'HARDWARE UNREACHABLE';
    dhtStatus.style.color = 'var(--text-dim)';
  }

  const soilElem = document.getElementById('soil');
  const soilStatus = document.getElementById('soilStatus');
  if (soilElem) soilElem.textContent = '-- %';
  if (soilStatus) soilStatus.textContent = 'ESP32 not detected. Connect device or run simulation.';

  const rainElem = document.getElementById('rain');
  const rainStatus = document.getElementById('rainStatus');
  const buzzerStatus = document.getElementById('buzzerStatus');
  if (rainElem) {
    rainElem.textContent = '--';
    rainElem.className = 'card-value accent-blue';
  }
  if (rainStatus) rainStatus.textContent = 'Hardware link inactive';
  if (buzzerStatus) {
    buzzerStatus.textContent = 'STANDBY';
    buzzerStatus.style.color = 'var(--text-dim)';
  }

  const soilRawElem = document.getElementById('soilRaw');
  const rainRawElem = document.getElementById('rainRaw');
  const lastUpdateElem = document.getElementById('lastUpdate');
  if (soilRawElem) soilRawElem.textContent = '--';
  if (rainRawElem) rainRawElem.textContent = '--';
  if (lastUpdateElem) lastUpdateElem.textContent = 'Polling... (' + new Date().toLocaleTimeString() + ')';
}

function simulateTelemetryTick() {
  const s = AppState.simulated;
  // Natural wandering fluctuation
  s.temp += (Math.random() - 0.48) * 0.15;
  s.temp = Math.max(16, Math.min(42, s.temp));

  s.humidity += (Math.random() - 0.49) * 0.3;
  s.humidity = Math.max(20, Math.min(95, s.humidity));

  if (s.raining) {
    s.rainRaw = Math.max(1100, Math.min(2200, s.rainRaw + (Math.random() - 0.5) * 50));
    s.soilMoisture = Math.min(96, s.soilMoisture + 0.2);
    s.soilRaw = Math.max(1200, 3000 - Math.round((s.soilMoisture / 100) * 1700));
    s.buzzer = true;
  } else {
    s.rainRaw = Math.max(3400, Math.min(4095, s.rainRaw + (Math.random() - 0.5) * 40));
    s.soilMoisture = Math.max(18, s.soilMoisture - 0.05);
    s.soilRaw = Math.max(1200, 3000 - Math.round((s.soilMoisture / 100) * 1700));
    s.buzzer = false;
  }

  const payload = {
    temperature: parseFloat(s.temp.toFixed(1)),
    humidity: parseFloat(s.humidity.toFixed(1)),
    soilRaw: s.soilRaw,
    rainRaw: s.rainRaw,
    soilMoisture: Math.round(s.soilMoisture),
    raining: s.raining,
    dhtValid: s.dhtValid,
    environment: evaluateEnvironmentString(s.temp, s.humidity, s.soilMoisture, s.raining),
    suggestions: []
  };

  renderSensorTelemetry(payload, true);
}

function evaluateEnvironmentString(t, h, sm, raining) {
  if (raining && sm > 70) return 'RAINY AND WET SOIL';
  if (raining) return 'ACTIVE PRECIPITATION';
  if (t > 35 && sm < 30) return 'CRITICAL HEAT & ARID';
  if (t > 32 && h > 75) return 'TROPICAL HUMID HEAT';
  if (sm < 25) return 'PARCHED SOIL DEFICIT';
  if (h > 85) return 'SATURATED HUMIDITY';
  if (t < 15) return 'COLD MICROCLIMATE';
  return 'OPTIMAL HOMEOSTASIS';
}

function renderSensorTelemetry(d, isSim) {
  AppState.lastSensorData = d;
  const timeStr = new Date().toLocaleTimeString();

  // Mode & connection status badge
  const statusBadge = document.getElementById('connectionStatus');
  const deviceStatusText = document.getElementById('deviceStatus');

  if (isSim) {
    statusBadge.className = 'badge-mode badge-simulation';
    statusBadge.innerHTML = '<span class="status-dot"></span> SIMULATION MODE';
    deviceStatusText.textContent = 'SIMULATED BENCH DATA (CLIENT-SIDE)';
    deviceStatusText.style.color = 'var(--orange)';
  } else {
    statusBadge.className = 'badge-mode badge-online';
    statusBadge.innerHTML = '<span class="status-dot"></span> ESP32 ONLINE';
    deviceStatusText.textContent = 'CONNECTED (ESP32 HARDWARE)';
    deviceStatusText.style.color = 'var(--green)';
  }

  // DHT11 Values
  const tempVal = document.getElementById('temp');
  const humVal = document.getElementById('humidity');
  const dhtStatus = document.getElementById('dhtStatus');

  if (d.dhtValid) {
    let displayTemp = d.temperature;
    let unitLabel = '°C';
    if (AppState.tempUnit === 'F') {
      displayTemp = (d.temperature * 9) / 5 + 32;
      unitLabel = '°F';
    }
    tempVal.textContent = `${displayTemp.toFixed(1)} ${unitLabel}`;
    humVal.textContent = `${d.humidity.toFixed(1)} %`;
    dhtStatus.textContent = 'ACTIVE / HEALTHY';
    dhtStatus.style.color = 'var(--green)';

    pushChartPoint(climateChart, timeStr, [d.temperature, d.humidity]);
  } else {
    tempVal.textContent = '--';
    humVal.textContent = '--';
    dhtStatus.textContent = 'DHT11 READ ERROR';
    dhtStatus.style.color = 'var(--red)';
  }

  // Soil Moisture
  const soilElem = document.getElementById('soil');
  const soilStatus = document.getElementById('soilStatus');
  const soilBar = document.getElementById('soilProgressBar');

  soilElem.textContent = `${d.soilMoisture} %`;
  if (soilBar) {
    soilBar.style.width = `${Math.min(100, Math.max(0, d.soilMoisture))}%`;
    soilBar.style.backgroundColor = d.soilMoisture < 30 ? 'var(--red)' : (d.soilMoisture < 65 ? 'var(--green)' : 'var(--blue)');
  }

  soilStatus.textContent =
    d.soilMoisture < 25 ? 'Critical dry (Irrigate now)' :
    d.soilMoisture < 45 ? 'Moderate dry' :
    d.soilMoisture <= 75 ? 'Optimal moisture level' :
    'Saturated / Waterlogged';

  pushChartPoint(soilChart, timeStr, [d.soilMoisture]);

  // Rain Sensor & Buzzer
  const rainElem = document.getElementById('rain');
  const rainStatus = document.getElementById('rainStatus');
  const buzzerStatus = document.getElementById('buzzerStatus');

  if (d.raining) {
    rainElem.textContent = 'RAIN ACTIVE';
    rainElem.className = 'card-value accent-red';
    rainStatus.textContent = 'Water droplets detected on plate';
    buzzerStatus.textContent = 'BUZZER ACTIVE (GPIO 26 HIGH)';
    buzzerStatus.style.color = 'var(--red)';
    playBuzzerAlert();
  } else {
    rainElem.textContent = 'DRY / CLEAR';
    rainElem.className = 'card-value accent-blue';
    rainStatus.textContent = 'No moisture on sensor plate';
    buzzerStatus.textContent = 'STANDBY (GPIO 26 LOW)';
    buzzerStatus.style.color = 'var(--text-muted)';
  }

  // Raw Diagnostic Readouts
  document.getElementById('soilRaw').textContent = `${d.soilRaw} (12-bit ADC)`;
  document.getElementById('rainRaw').textContent = `${d.rainRaw} (12-bit ADC)`;
  document.getElementById('lastUpdate').textContent = timeStr;

  // Log Telemetry for CSV Export
  AppState.telemetryLogs.push({
    timestamp: new Date().toISOString(),
    tempC: d.temperature,
    humidity: d.humidity,
    soilRaw: d.soilRaw,
    soilMoisture: d.soilMoisture,
    rainRaw: d.rainRaw,
    raining: d.raining
  });
  if (AppState.telemetryLogs.length > 500) AppState.telemetryLogs.shift();

  renderAdvisor();
}

// ============================================================
// 4. OPEN-METEO WEATHER ENGINE
// ============================================================

const WeatherCodeDictionary = {
  0: { text: 'Clear Sky', icon: '☀️' },
  1: { text: 'Mainly Clear', icon: '🌤️' },
  2: { text: 'Partly Cloudy', icon: '⛅' },
  3: { text: 'Overcast Sky', icon: '☁️' },
  45: { text: 'Foggy Mist', icon: '🌫️' },
  48: { text: 'Depositing Rime Fog', icon: '🌫️' },
  51: { text: 'Light Drizzle', icon: '🌧️' },
  53: { text: 'Moderate Drizzle', icon: '🌧️' },
  55: { text: 'Heavy Dense Drizzle', icon: '🌧️' },
  61: { text: 'Slight Rain', icon: '🌦️' },
  63: { text: 'Moderate Rainfall', icon: '🌧️' },
  65: { text: 'Heavy Intense Rain', icon: '🌧️' },
  71: { text: 'Slight Snowfall', icon: '🌨️' },
  73: { text: 'Moderate Snowfall', icon: '❄️' },
  75: { text: 'Heavy Blizzard Snow', icon: '❄️' },
  80: { text: 'Scattered Rain Showers', icon: '🌦️' },
  81: { text: 'Moderate Showers', icon: '🌧️' },
  82: { text: 'Violent Cloudburst', icon: '⛈️' },
  95: { text: 'Thunderstorm', icon: '⚡' },
  96: { text: 'Thunderstorm with Hail', icon: '⛈️' },
  99: { text: 'Severe Thunderstorm', icon: '⛈️' }
};

async function detectCoordinates() {
  if (navigator.geolocation) {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 6000,
          maximumAge: 300000
        });
      });
      return {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        name: 'Local GPS Station'
      };
    } catch (e) {
      console.log('GPS Geolocation unavailable, falling back to IP lookup.');
    }
  }

  try {
    const ipRes = await fetch('https://ipapi.co/json/');
    if (ipRes.ok) {
      const ipData = await ipRes.json();
      if (ipData.latitude && ipData.longitude) {
        return {
          lat: ipData.latitude,
          lon: ipData.longitude,
          name: [ipData.city, ipData.region, ipData.country_name].filter(Boolean).join(', ')
        };
      }
    }
  } catch (err) {
    console.warn('IP location fetch failed:', err);
  }

  return { lat: 28.6139, lon: 77.2090, name: 'Default Research Station' };
}

async function fetchLiveWeather() {
  const locElem = document.getElementById('weatherLocation');
  const condElem = document.getElementById('weatherCondition');
  if (locElem) locElem.textContent = 'Acquiring satellite coordinate lock...';

  try {
    const loc = await detectCoordinates();
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(4)}&longitude=${loc.lon.toFixed(4)}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);

    const data = await res.json();
    AppState.lastWeatherData = data;

    // Render Current Weather Block
    locElem.textContent = `📍 ${loc.name} (${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°)`;
    const cur = data.current;
    const weatherInfo = WeatherCodeDictionary[cur.weather_code] || { text: 'Variable Sky', icon: '🌤️' };

    document.getElementById('outTemp').textContent = `${cur.temperature_2m}°C`;
    document.getElementById('feelsLike').textContent = `${cur.apparent_temperature}°C`;
    document.getElementById('outHumidity').textContent = `${cur.relative_humidity_2m}%`;
    document.getElementById('windSpeed').textContent = `${cur.wind_speed_10m} km/h`;
    document.getElementById('precipitation').textContent = `${cur.precipitation} mm`;
    condElem.textContent = weatherInfo.text;
    document.getElementById('weatherIcon').textContent = weatherInfo.icon;

    // Render 24h Hourly Strip
    const hourlyBox = document.getElementById('hourlyForecast');
    hourlyBox.innerHTML = '';
    const curTimeMs = new Date(cur.time).getTime();
    let startIdx = data.hourly.time.findIndex(t => new Date(t).getTime() >= curTimeMs);
    if (startIdx < 0) startIdx = 0;

    for (let i = startIdx; i < Math.min(startIdx + 24, data.hourly.time.length); i++) {
      const code = data.hourly.weather_code[i];
      const hInfo = WeatherCodeDictionary[code] || { icon: '🌤️' };
      const item = document.createElement('div');
      item.className = 'forecast-item';
      item.innerHTML = `
        <small>${new Date(data.hourly.time[i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
        <div style="font-size:26px;margin:8px 0;">${hInfo.icon}</div>
        <h3>${data.hourly.temperature_2m[i]}°</h3>
        <p>Rain ${data.hourly.precipitation_probability[i]}%</p>
      `;
      hourlyBox.appendChild(item);
    }

    // Render 7-Day Forecast Grid
    const weekBox = document.getElementById('weeklyForecast');
    weekBox.innerHTML = '';
    const daily = data.daily;
    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
      const dCode = daily.weather_code[i];
      const dInfo = WeatherCodeDictionary[dCode] || { icon: '🌤️' };
      const dayDate = new Date(daily.time[i] + 'T12:00:00');
      const item = document.createElement('div');
      item.className = 'week-item';
      item.innerHTML = `
        <small>${dayDate.toLocaleDateString([], { weekday: 'short' })}</small>
        <div style="font-size:22px;margin:8px 0;">${dInfo.icon}</div>
        <h3>${daily.temperature_2m_max[i]}°</h3>
        <p>Min ${daily.temperature_2m_min[i]}°</p>
        <p style="color:var(--blue);margin-top:4px;">☔ ${daily.precipitation_probability_max[i]}%</p>
      `;
      weekBox.appendChild(item);
    }

    // Render Weather Forecast Chart
    if (weatherChart) {
      weatherChart.data.labels = [];
      weatherChart.data.datasets[0].data = [];
      weatherChart.data.datasets[1].data = [];

      for (let i = startIdx; i < Math.min(startIdx + 24, data.hourly.time.length); i++) {
        const timeLabel = new Date(data.hourly.time[i]).toLocaleTimeString([], { hour: '2-digit' });
        weatherChart.data.labels.push(timeLabel);
        weatherChart.data.datasets[0].data.push(data.hourly.temperature_2m[i]);
        weatherChart.data.datasets[1].data.push(data.hourly.precipitation_probability[i]);
      }
      weatherChart.update('none');
    }

    const updatedElem = document.getElementById('weatherUpdated');
    if (updatedElem) {
      updatedElem.textContent = `Numerical Model Sync: ${new Date().toLocaleTimeString()} · ECMWF / Open-Meteo High-Resolution`;
    }

    renderAdvisor();
  } catch (err) {
    if (locElem) locElem.textContent = 'Weather Telemetry Unavailable (Inspect Connection)';
    console.error('Weather pipeline failure:', err);
  }
}

// ============================================================
// 5. REAL-TIME SMART ADVISOR ENGINE
// ============================================================

function renderAdvisor() {
  const container = document.getElementById('suggestions');
  if (!container) return;

  const d = AppState.lastSensorData;
  const w = AppState.lastWeatherData;

  if (!d) {
    container.innerHTML = '<div class="suggestion normal"><div class="suggestion-icon">ℹ️</div><div><strong>Standby Mode</strong><br>Awaiting sensor data to run diagnostic evaluation.</div></div>';
    return;
  }

  const alerts = [];
  function pushAlert(level, icon, title, desc) {
    alerts.push({ level, icon, title, desc });
  }

  // Microclimate & Sensor Rules
  if (!d.dhtValid) {
    pushAlert('danger', '⚠️', 'DHT11 Sensor Signal Fault', 'Digital 1-wire communication line interrupted. Verify GPIO 4 jumper cable, pull-up resistor, and 3.3V rail.');
  } else {
    if (d.temperature > 35) {
      pushAlert('danger', '🔥', 'Severe Heat Stress Warning', `Ambient temperature (${d.temperature.toFixed(1)}°C) exceeds safety thresholds. Deploy shade tarps and increase misting.`);
    } else if (d.temperature < 15) {
      pushAlert('warning', '❄️', 'Cold Microclimate Advisory', `Low thermal register (${d.temperature.toFixed(1)}°C) detected. Activate greenhouse heaters or protective covers.`);
    }

    if (d.humidity > 85) {
      pushAlert('warning', '💧', 'High Relative Humidity (Pathogen Risk)', `Elevated relative humidity (${d.humidity.toFixed(1)}%) creates ideal conditions for fungal spore proliferation. Increase ventilation.`);
    }
  }

  // Soil Hydrometry Rules
  if (d.soilMoisture < 25) {
    pushAlert('danger', '🌵', 'Critical Soil Desiccation', `Subsurface volumetric moisture (${d.soilMoisture}%) breached permanent wilting threshold. Initiate drip irrigation immediately.`);
  } else if (d.soilMoisture > 80) {
    pushAlert('warning', '🌊', 'Root Zone Saturated / Waterlogged', `Soil moisture (${d.soilMoisture}%) is excessively saturated. Disable all pumps to prevent root hypoxia.`);
  }

  // Pluviometric Acoustic Alarm State
  if (d.raining) {
    pushAlert('danger', '🌧️', 'Active Precipitation Detected', 'Surface conductance triggers active alarm buzzer. Rain detected on sensor array.');
  }

  // Multi-Variable Weather Fusion Rules
  if (w && w.daily) {
    const nearRainProb = Math.max(...w.daily.precipitation_probability_max.slice(0, 2));
    const nextMaxTemp = Math.max(...w.daily.temperature_2m_max.slice(0, 2));

    if (nearRainProb >= 70 && d.soilMoisture > 35) {
      pushAlert('warning', '🛰️', 'Forecast Rain: Suspend Irrigation', `Numerical forecast predicts ${nearRainProb}% precipitation within 48h while soil moisture is adequate (${d.soilMoisture}%). Suspend watering.`);
    }

    if (nearRainProb >= 75 && d.soilMoisture < 30) {
      pushAlert('normal', '🌧️', 'Imminent Rainfall with Parched Soil', `Incoming rain will naturally recharge moisture deficit (${d.soilMoisture}%). Observe actual rain before manual pump activation.`);
    }

    if (nextMaxTemp > 35 && d.soilMoisture < 40) {
      pushAlert('danger', '⚡', 'High Temperature & Low Moisture Convergence', `Upcoming day maximum of ${nextMaxTemp}°C coupled with dry soil (${d.soilMoisture}%) will cause acute heat stress.`);
    }

    if (d.raining && nearRainProb < 25) {
      pushAlert('warning', '🔍', 'Telemetry vs Forecast Divergence', `Physical rain sensor detected water, yet forecast rain chance is only ${nearRainProb}%. May represent localized micro-precipitation or dew accumulation.`);
    }
  }

  if (alerts.length === 0) {
    pushAlert('normal', '✅', 'Optimal Homeostatic Equilibrium', 'All environmental parameters (temperature, humidity, soil hydration) are currently within optimal agronomic bounds.');
  }

  // Render Alert DOM Cards
  container.innerHTML = '';
  alerts.forEach(item => {
    const div = document.createElement('div');
    div.className = `suggestion ${item.level}`;
    div.innerHTML = `
      <div class="suggestion-icon">${item.icon}</div>
      <div>
        <strong>${item.title}</strong><br>
        <span>${item.desc}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

// ============================================================
// 6. CSV TELEMETRY EXPORT
// ============================================================

function exportTelemetryCSV() {
  if (AppState.telemetryLogs.length === 0) {
    alert('No telemetry records collected yet.');
    return;
  }

  const headers = ['ISO_Timestamp', 'Temperature_C', 'Humidity_Pct', 'Soil_Raw_ADC', 'Soil_Moisture_Pct', 'Rain_Raw_ADC', 'Raining_Boolean'];
  const rows = AppState.telemetryLogs.map(r => [
    r.timestamp,
    r.tempC,
    r.humidity,
    r.soilRaw,
    r.soilMoisture,
    r.rainRaw,
    r.raining
  ].join(','));

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `environmental_telemetry_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ============================================================
// 7. FIRMWARE CODE DOWNLOAD & MODAL HANDLERS
// ============================================================

function downloadInoFile(filename = 'Smart_Environment_Monitor.ino') {
  try {
    const blob = new Blob([ESP32_FIRMWARE_CODE], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('File download error:', err);
    window.open('firmware/Smart_Environment_Monitor.ino', '_blank');
  }
}

function copyFirmwareCode(triggerBtn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ESP32_FIRMWARE_CODE).then(() => {
      showCopyFeedback(triggerBtn);
    }).catch(() => {
      fallbackCopyText(triggerBtn);
    });
  } else {
    fallbackCopyText(triggerBtn);
  }
}

function showCopyFeedback(btn) {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.innerHTML = '✅ Copied to Clipboard!';
  btn.style.borderColor = 'var(--green)';
  btn.style.color = 'var(--green)';
  setTimeout(() => {
    btn.innerHTML = original;
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 2200);
}

function fallbackCopyText(triggerBtn) {
  const textArea = document.createElement('textarea');
  textArea.value = ESP32_FIRMWARE_CODE;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    showCopyFeedback(triggerBtn);
  } catch (e) {
    alert('Please select and copy the code manually from the viewer.');
  }
  document.body.removeChild(textArea);
}

function openFirmwareModal() {
  const modal = document.getElementById('firmwareModal');
  if (modal) modal.classList.add('active');
}

function closeFirmwareModal() {
  const modal = document.getElementById('firmwareModal');
  if (modal) modal.classList.remove('active');
}

// ============================================================
// 8. SIMULATION TOGGLE & USER INTERFACE HANDLERS
// ============================================================

function toggleSimulationMode(forceState) {
  if (typeof forceState === 'boolean') {
    AppState.isSimulation = forceState;
  } else {
    AppState.isSimulation = !AppState.isSimulation;
  }

  const isSim = AppState.isSimulation;
  const headerBtn = document.getElementById('toggleSimBtn');
  const toolbarBtn = document.getElementById('masterSimToggleBtn');
  const statusBadge = document.getElementById('connectionStatus');
  const toolbarState = document.getElementById('simToolbarState');

  if (isSim) {
    if (headerBtn) headerBtn.textContent = '⏹️ Stop Simulation (Switch to ESP32)';
    if (toolbarBtn) {
      toolbarBtn.textContent = '⏹️ Stop Simulation';
      toolbarBtn.className = 'btn-secondary';
    }
    if (toolbarState) {
      toolbarState.className = 'sim-state-chip active';
      toolbarState.innerHTML = '● SIMULATION: ACTIVE (BENCH TEST)';
    }
    if (statusBadge) {
      statusBadge.className = 'badge-mode badge-simulation';
      statusBadge.innerHTML = '<span class="status-dot"></span> SIMULATION MODE';
    }
    simulateTelemetryTick();
  } else {
    if (headerBtn) headerBtn.textContent = '▶️ Run Simulation (Optional)';
    if (toolbarBtn) {
      toolbarBtn.textContent = '▶️ Activate Simulation Bench';
      toolbarBtn.className = 'btn-warning';
    }
    if (toolbarState) {
      toolbarState.className = 'sim-state-chip off';
      toolbarState.innerHTML = '● SIMULATION: OFF (HARDWARE LINK)';
    }
    fetchSensorTelemetry();
  }
}

function openEndpointModal() {
  const modal = document.getElementById('configModal');
  const input = document.getElementById('endpointInput');
  if (modal && input) {
    input.value = AppState.apiEndpoint;
    modal.classList.add('active');
  }
}

function closeEndpointModal() {
  const modal = document.getElementById('configModal');
  if (modal) modal.classList.remove('active');
}

function saveEndpointModal() {
  const input = document.getElementById('endpointInput');
  if (input && input.value.trim()) {
    AppState.apiEndpoint = input.value.trim();
    // Switch to hardware mode and test connection immediately
    toggleSimulationMode(false);
  }
  closeEndpointModal();
}

// Simulation Quick Controls
window.simToggleRain = function() {
  if (!AppState.isSimulation) toggleSimulationMode(true);
  AppState.simulated.raining = !AppState.simulated.raining;
  simulateTelemetryTick();
};

window.simSetDrySoil = function() {
  if (!AppState.isSimulation) toggleSimulationMode(true);
  AppState.simulated.soilMoisture = 18;
  AppState.simulated.soilRaw = 2950;
  simulateTelemetryTick();
};

window.simSetWetSoil = function() {
  if (!AppState.isSimulation) toggleSimulationMode(true);
  AppState.simulated.soilMoisture = 85;
  AppState.simulated.soilRaw = 1350;
  simulateTelemetryTick();
};

window.simSetHeatwave = function() {
  if (!AppState.isSimulation) toggleSimulationMode(true);
  AppState.simulated.temp = 39.5;
  AppState.simulated.humidity = 24.0;
  simulateTelemetryTick();
};

// ============================================================
// 9. APPLICATION BOOTSTRAP
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Chart.js surfaces
  initCharts();

  // Populate Firmware Code Previews
  const embedCodeBox = document.getElementById('embeddedCodeBox');
  if (embedCodeBox) {
    embedCodeBox.textContent = ESP32_FIRMWARE_CODE;
  }
  const modalCodeBox = document.getElementById('modalCodeBox');
  if (modalCodeBox) {
    modalCodeBox.textContent = ESP32_FIRMWARE_CODE;
  }

  // Simulation is strictly OPTIONAL and OFF by default.
  AppState.isSimulation = false;

  // Attach Weather Refresh
  const refreshWeatherBtn = document.getElementById('refreshWeatherBtn');
  if (refreshWeatherBtn) refreshWeatherBtn.addEventListener('click', fetchLiveWeather);

  // Attach Simulation Toggles
  const toggleSimBtn = document.getElementById('toggleSimBtn');
  if (toggleSimBtn) {
    toggleSimBtn.addEventListener('click', () => toggleSimulationMode());
  }

  const masterSimToggleBtn = document.getElementById('masterSimToggleBtn');
  if (masterSimToggleBtn) {
    masterSimToggleBtn.addEventListener('click', () => toggleSimulationMode());
  }

  // Attach IP Endpoint Modal
  const configEndpointBtn = document.getElementById('configEndpointBtn');
  if (configEndpointBtn) configEndpointBtn.addEventListener('click', openEndpointModal);

  const saveEndpointBtn = document.getElementById('saveEndpointBtn');
  if (saveEndpointBtn) saveEndpointBtn.addEventListener('click', saveEndpointModal);

  const closeEndpointBtn = document.getElementById('closeEndpointBtn');
  if (closeEndpointBtn) closeEndpointBtn.addEventListener('click', closeEndpointModal);

  // Attach Firmware Modal and Download/Copy Buttons
  const openFirmwareModalBtn = document.getElementById('openFirmwareModalBtn');
  if (openFirmwareModalBtn) openFirmwareModalBtn.addEventListener('click', openFirmwareModal);

  const closeFirmwareModalBtn = document.getElementById('closeFirmwareModalBtn');
  if (closeFirmwareModalBtn) closeFirmwareModalBtn.addEventListener('click', closeFirmwareModal);

  const closeFirmwareModalBtn2 = document.getElementById('closeFirmwareModalBtn2');
  if (closeFirmwareModalBtn2) closeFirmwareModalBtn2.addEventListener('click', closeFirmwareModal);

  // Download .ino buttons
  const downloadInoFileBtn = document.getElementById('downloadInoFileBtn');
  if (downloadInoFileBtn) downloadInoFileBtn.addEventListener('click', () => downloadInoFile());

  const downloadEmbedCodeBtn = document.getElementById('downloadEmbedCodeBtn');
  if (downloadEmbedCodeBtn) downloadEmbedCodeBtn.addEventListener('click', () => downloadInoFile());

  const modalDownloadInoBtn = document.getElementById('modalDownloadInoBtn');
  if (modalDownloadInoBtn) modalDownloadInoBtn.addEventListener('click', () => downloadInoFile());

  const modalDownloadBottomBtn = document.getElementById('modalDownloadBottomBtn');
  if (modalDownloadBottomBtn) modalDownloadBottomBtn.addEventListener('click', () => downloadInoFile());

  // Copy code buttons
  const copyCodeSectionBtn = document.getElementById('copyCodeSectionBtn');
  if (copyCodeSectionBtn) copyCodeSectionBtn.addEventListener('click', (e) => copyFirmwareCode(e.currentTarget));

  const copyEmbedCodeBtn = document.getElementById('copyEmbedCodeBtn');
  if (copyEmbedCodeBtn) copyEmbedCodeBtn.addEventListener('click', (e) => copyFirmwareCode(e.currentTarget));

  const modalCopyCodeBtn = document.getElementById('modalCopyCodeBtn');
  if (modalCopyCodeBtn) modalCopyCodeBtn.addEventListener('click', (e) => copyFirmwareCode(e.currentTarget));

  // CSV Export & Audio Buzzer
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportTelemetryCSV);

  const audioToggle = document.getElementById('audioBuzzerToggle');
  if (audioToggle) {
    audioToggle.addEventListener('change', (e) => {
      AppState.audioBuzzerEnabled = e.target.checked;
    });
  }

  // Initial Data Cycles
  fetchSensorTelemetry(); // Queries live ESP32; if unreachable, marks OFFLINE without auto-simulating
  fetchLiveWeather();     // Queries satellite NWP weather model

  // Periodic Telemetry Loop (Every 2.5s matching ESP32 hardware interval)
  setInterval(fetchSensorTelemetry, 2500);

  // Periodic Weather Refresh (Every 10 minutes)
  setInterval(fetchLiveWeather, 600000);
});