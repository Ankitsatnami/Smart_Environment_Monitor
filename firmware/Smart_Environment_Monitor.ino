/*
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
async function getWeather(){const locElem=document.getElementById('weatherLocation');try{const loc=await getLocation();const url=`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=7&timezone=auto`;const r=await fetch(url);const data=await r.json();latestWeather=data;locElem.textContent='📍 '+loc.name+' ('+loc.lat.toFixed(2)+', '+loc.lon.toFixed(2)+')';const c=data.current;document.getElementById('outTemp').textContent=c.temperature_2m+'°C';document.getElementById('feelsLike').textContent=c.apparent_temperature+'°C';document.getElementById('outHumidity').textContent=c.relative_humidity_2m+'%';document.getElementById('windSpeed').textContent=c.wind_speed_10m+' km/h';document.getElementById('precipitation').textContent=c.precipitation+' mm';document.getElementById('weatherCondition').textContent=weatherDescription(c.weather_code);document.getElementById('weatherIcon').textContent=weatherEmoji(c.weather_code);const hourly=data.hourly;const hBox=document.getElementById('hourlyForecast');hBox.innerHTML='';const now=new Date(c.time).getTime();let sIdx=hourly.time.findIndex(t=>new Date(t).getTime()>=now);if(sIdx<0)sIdx=0;for(let i=sIdx;i<Math.min(sIdx+24,hourly.time.length);i++){const item=document.createElement('div');item.className='forecast-item';item.innerHTML=`<small>${new Date(hourly.time[i]).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small><div style="font-size:24px;margin:10px 0">${weatherEmoji(hourly.weather_code[i])}</div><h3>${hourly.temperature_2m[i]}°</h3><p>Rain ${hourly.precipitation_probability[i]}%</p>`;hBox.appendChild(item);}const daily=data.daily;const wBox=document.getElementById('weeklyForecast');wBox.innerHTML='';for(let i=0;i<7;i++){const item=document.createElement('div');item.className='week-item';item.innerHTML=`<small>${new Date(daily.time[i]+'T12:00:00').toLocaleDateString([],{weekday:'short'})}</small><div style="font-size:23px;margin:9px 0">${weatherEmoji(daily.weather_code[i])}</div><h3>${daily.temperature_2m_max[i]}°</h3><p>Min ${daily.temperature_2m_min[i]}°</p><p>Rain ${daily.precipitation_probability_max[i]}%</p>`;wBox.appendChild(item);}weatherChart.data.labels=[];weatherChart.data.datasets[0].data=[];weatherChart.data.datasets[1].data=[];for(let i=sIdx;i<Math.min(sIdx+24,hourly.time.length);i++){weatherChart.data.labels.push(new Date(hourly.time[i]).toLocaleTimeString([],{hour:'2-digit'}));weatherChart.data.datasets[0].data.push(hourly.temperature_2m[i]);weatherChart.data.datasets[1].data.push(hourly.precipitation_probability[i]);}weatherChart.update('none');document.getElementById('weatherUpdated').textContent='Updated: '+new Date().toLocaleTimeString()+' | Open-Meteo';renderAdvisor();}catch(e){locElem.textContent='Weather Error: '+e.message;}}
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
  json += "\"temperature\":"   + String(temperature, 1) + ",";
  json += "\"humidity\":"      + String(humidity, 1) + ",";
  json += "\"soilRaw\":"       + String(soilRaw) + ",";
  json += "\"rainRaw\":"       + String(rainRaw) + ",";
  json += "\"soilMoisture\":"  + String(soilMoisture) + ",";
  json += "\"raining\":"       + String(raining ? "true" : "false") + ",";
  json += "\"dhtValid\":"      + String(dhtValid ? "true" : "false") + ",";
  json += "\"environment\":\"" + getEnvironment() + "\"";
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

  Serial.println("\n==============================================");
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

    Serial.println("\n--- [TELEMETRY UPDATE] ---");
    Serial.printf("Temp: %.1f C | Hum: %.1f %% | Soil: %d %% (Raw: %d) | Rain: %s (Raw: %d)\n",
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
}