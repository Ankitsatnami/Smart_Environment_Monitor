/**
 * ============================================================
 * SMART ENVIRONMENTAL MONITORING SYSTEM - WEB APPLICATION ENGINE
 * Client-Side Orchestrator, Chart.js Visualizer & Weather Fusion
 * Author: Ankit Satnami | GitHub: @Ankitsatnami
 * ============================================================
 */

// Application State
const AppState = {
  isSimulation: false,
  apiEndpoint: '/api/data', // Relative for ESP32 host, configurable for GitHub Pages
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
  if (AppState.isSimulation) {
    simulateTelemetryTick();
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2400);

    const response = await fetch(AppState.apiEndpoint, {
      signal: controller.signal,
      cache: 'no-store'
    });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('ESP32 status: ' + response.status);

    const data = await response.json();
    renderSensorTelemetry(data, false);
  } catch (error) {
    // If running on GitHub Pages (static host) or ESP32 unreachable, gracefully fall back to Simulation Mode
    console.warn('Live ESP32 unreachable. Falling back to Interactive Simulation Mode.', error);
    setConnectionMode(true);
    simulateTelemetryTick();
  }
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
    suggestions: [] // Evaluated dynamically below
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
    deviceStatusText.textContent = 'SIMULATED (CLIENT-SIDE)';
  } else {
    statusBadge.className = 'badge-mode badge-online';
    statusBadge.innerHTML = '<span class="status-dot"></span> ESP32 ONLINE';
    deviceStatusText.textContent = 'CONNECTED (ESP32 HARDWARE)';
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
  // 1. Try Browser Geolocation API
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

  // 2. Try IP-API Location Resolver
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

  // 3. Fallback Coordinates (New Delhi, India / International standard hub)
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

    document.getElementById('outTemp').textContent = `${cur.temperature_2m.toFixed(1)}°C`;
    document.getElementById('feelsLike').textContent = `${cur.apparent_temperature.toFixed(1)}°C`;
    document.getElementById('outHumidity').textContent = `${cur.relative_humidity_2m}%`;
    document.getElementById('windSpeed').textContent = `${cur.wind_speed_10m} km/h`;
    document.getElementById('precipitation').textContent = `${cur.precipitation} mm`;
    condElem.textContent = weatherInfo.text;
    document.getElementById('weatherIcon').textContent = weatherInfo.icon;

    // Hourly Forecast (Next 24h)
    const hourlyBox = document.getElementById('hourlyForecast');
    if (hourlyBox && data.hourly) {
      hourlyBox.innerHTML = '';
      const now = new Date(cur.time).getTime();
      let startIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= now);
      if (startIndex < 0) startIndex = 0;

      for (let i = startIndex; i < Math.min(startIndex + 24, data.hourly.time.length); i++) {
        const timeStr = new Date(data.hourly.time[i]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const hCode = data.hourly.weather_code[i];
        const hInfo = WeatherCodeDictionary[hCode] || { text: 'Sky', icon: '🌤️' };

        const item = document.createElement('div');
        item.className = 'forecast-item';
        item.innerHTML = `
          <small>${timeStr}</small>
          <div style="font-size:24px;margin:8px 0;">${hInfo.icon}</div>
          <h3>${data.hourly.temperature_2m[i].toFixed(0)}°</h3>
          <p>💧 ${data.hourly.precipitation_probability[i]}%</p>
        `;
        hourlyBox.appendChild(item);
      }

      // Populate Weather Chart
      if (weatherChart) {
        weatherChart.data.labels = [];
        weatherChart.data.datasets[0].data = [];
        weatherChart.data.datasets[1].data = [];

        for (let i = startIndex; i < Math.min(startIndex + 24, data.hourly.time.length); i++) {
          const tLabel = new Date(data.hourly.time[i]).toLocaleTimeString([], { hour: '2-digit' });
          weatherChart.data.labels.push(tLabel);
          weatherChart.data.datasets[0].data.push(data.hourly.temperature_2m[i]);
          weatherChart.data.datasets[1].data.push(data.hourly.precipitation_probability[i]);
        }
        weatherChart.update('none');
      }
    }

    // Weekly Forecast Grid (7 Days)
    const weekBox = document.getElementById('weeklyForecast');
    if (weekBox && data.daily) {
      weekBox.innerHTML = '';
      for (let i = 0; i < Math.min(7, data.daily.time.length); i++) {
        const dayDate = new Date(data.daily.time[i] + 'T12:00:00');
        const dayTitle = i === 0 ? 'Today' : dayDate.toLocaleDateString([], { weekday: 'short' });
        const dCode = data.daily.weather_code[i];
        const dInfo = WeatherCodeDictionary[dCode] || { text: 'Sky', icon: '🌤️' };

        const item = document.createElement('div');
        item.className = 'week-item';
        item.innerHTML = `
          <small>${dayTitle}</small>
          <div style="font-size:24px;margin:8px 0;">${dInfo.icon}</div>
          <h3>${data.daily.temperature_2m_max[i].toFixed(0)}°</h3>
          <div class="temp-min">Min ${data.daily.temperature_2m_min[i].toFixed(0)}°</div>
          <div class="rain-prob">Rain ${data.daily.precipitation_probability_max[i]}%</div>
        `;
        weekBox.appendChild(item);
      }
    }

    const updatedText = document.getElementById('weatherUpdated');
    if (updatedText) {
      updatedText.textContent = `Telemetry Synced: ${new Date().toLocaleTimeString()} | Source: Open-Meteo ECMWF/GFS Numerical Models`;
    }

    renderAdvisor();
  } catch (error) {
    console.error('Weather fetching failure:', error);
    if (locElem) locElem.textContent = 'Weather Station Offline: ' + error.message;
  }
}

// ============================================================
// 5. SMART ENVIRONMENTAL ADVISOR RULE ENGINE
// ============================================================

function renderAdvisor() {
  const container = document.getElementById('suggestions');
  if (!container) return;

  const d = AppState.lastSensorData;
  const w = AppState.lastWeatherData;
  if (!d) return;

  const alerts = [];
  function pushAlert(level, icon, title, desc) {
    alerts.push({ level, icon, title, desc });
  }

  // 1. Hardware & Sensor Validation
  if (!d.dhtValid) {
    pushAlert('danger', '⚠️', 'DHT11 Sensor Signal Loss', 'The digital humidity & temperature sensor is not acknowledging the 1-Wire protocol. Verify GPIO 4 connection and pull-up resistor.');
  } else {
    // Thermal Analysis
    if (d.temperature > 38.0) {
      pushAlert('danger', '🔥', 'Severe Heat Stress Hazard', `Ambient temperature (${d.temperature.toFixed(1)}°C) exceeds safety limits. Implement automated shading curtains and evaporative cooling.`);
    } else if (d.temperature > 32.0) {
      pushAlert('warning', '☀️', 'Elevated Ambient Temperature', `High temperature (${d.temperature.toFixed(1)}°C) accelerates evapotranspiration. Increase soil hydration monitoring frequency.`);
    } else if (d.temperature < 14.0) {
      pushAlert('warning', '❄️', 'Low Temperature Inversion', `Chilled temperature (${d.temperature.toFixed(1)}°C) may induce cold-shock in delicate flora. Safeguard root zones.`);
    }

    // Atmospheric Vapor Analysis
    if (d.humidity > 85.0) {
      pushAlert('warning', '💧', 'High Relative Humidity (Pathogen Risk)', `Sustained humidity (${d.humidity.toFixed(1)}%) promotes mildew and fungal spore germination. Maximize ventilation airflow.`);
    } else if (d.humidity < 28.0) {
      pushAlert('warning', '🏜️', 'Dry Atmospheric Deficit', `Low ambient humidity (${d.humidity.toFixed(1)}%) creates high vapor pressure deficit (VPD).`);
    }
  }

  // 2. Subsurface Soil Moisture Analysis
  if (d.soilMoisture < 25) {
    pushAlert('danger', '🌱', 'Severe Soil Moisture Depletion', `Soil moisture (${d.soilMoisture}%) is below permanent wilting point. Immediate gradual drip irrigation required.`);
  } else if (d.soilMoisture < 42) {
    pushAlert('warning', '🌾', 'Soil Moisture Approaching Deficit', `Soil moisture (${d.soilMoisture}%) is dropping. Prepare irrigation scheduling.`);
  } else if (d.soilMoisture > 82) {
    pushAlert('warning', '🌊', 'Subsurface Waterlogging Alert', `Soil moisture (${d.soilMoisture}%) indicates root saturation. Cease all irrigation to prevent root hypoxia/root rot.`);
  } else {
    pushAlert('normal', '✅', 'Soil Moisture In Optimal Agronomic Band', `Current moisture level (${d.soilMoisture}%) satisfies standard root respiration criteria.`);
  }

  // 3. Precipitation & Buzzer Safety
  if (d.raining) {
    if (d.soilMoisture > 70) {
      pushAlert('danger', '⛈️', 'Active Precipitation + Soil Saturation', 'Rain detected while soil moisture is already high. Verify surface drainage and shut off pump relays.');
    } else {
      pushAlert('warning', '🌧️', 'Active Rain Detected', 'Buzzer alerted on GPIO 26. External electrical equipment and moisture-sensitive sensors should be sealed.');
    }
  }

  // 4. Combined Sensor + Weather Model Predictive Advisory
  if (w && w.daily && w.daily.precipitation_probability_max) {
    const nearRainProb = Math.max(...w.daily.precipitation_probability_max.slice(0, 2));
    const nextMaxTemp = w.daily.temperature_2m_max[0];

    if (nearRainProb >= 70 && d.soilMoisture > 35) {
      pushAlert('warning', '🛰️', 'Predictive Rain Optimization', `Numerical forecast predicts ${nearRainProb}% rain probability within 48h. Postpone automated watering to conserve water.`);
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
// 7. USER INTERFACE EVENT HANDLERS & MODAL
// ============================================================

function setConnectionMode(isSim) {
  AppState.isSimulation = isSim;
  const toggleBtn = document.getElementById('toggleSimBtn');
  if (toggleBtn) {
    toggleBtn.textContent = isSim ? 'Switch to Live ESP32' : 'Switch to Demo Simulation';
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
    setConnectionMode(false);
    fetchSensorTelemetry();
  }
  closeEndpointModal();
}

// Simulation Quick Controls
window.simToggleRain = function() {
  AppState.simulated.raining = !AppState.simulated.raining;
  simulateTelemetryTick();
};

window.simSetDrySoil = function() {
  AppState.simulated.soilMoisture = 18;
  AppState.simulated.soilRaw = 2950;
  simulateTelemetryTick();
};

window.simSetWetSoil = function() {
  AppState.simulated.soilMoisture = 85;
  AppState.simulated.soilRaw = 1350;
  simulateTelemetryTick();
};

window.simSetHeatwave = function() {
  AppState.simulated.temp = 39.5;
  AppState.simulated.humidity = 24.0;
  simulateTelemetryTick();
};

// ============================================================
// 8. APPLICATION BOOTSTRAP
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initCharts();

  // If page is hosted on github.io or file://, default to Simulation mode with live weather
  if (window.location.hostname.includes('github.io') || window.location.protocol === 'file:') {
    AppState.isSimulation = true;
    setConnectionMode(true);
  }

  // Attach UI listeners
  const refreshWeatherBtn = document.getElementById('refreshWeatherBtn');
  if (refreshWeatherBtn) refreshWeatherBtn.addEventListener('click', fetchLiveWeather);

  const toggleSimBtn = document.getElementById('toggleSimBtn');
  if (toggleSimBtn) {
    toggleSimBtn.addEventListener('click', () => {
      setConnectionMode(!AppState.isSimulation);
      fetchSensorTelemetry();
    });
  }

  const configEndpointBtn = document.getElementById('configEndpointBtn');
  if (configEndpointBtn) configEndpointBtn.addEventListener('click', openEndpointModal);

  const saveEndpointBtn = document.getElementById('saveEndpointBtn');
  if (saveEndpointBtn) saveEndpointBtn.addEventListener('click', saveEndpointModal);

  const closeEndpointBtn = document.getElementById('closeEndpointBtn');
  if (closeEndpointBtn) closeEndpointBtn.addEventListener('click', closeEndpointModal);

  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportTelemetryCSV);

  const audioToggle = document.getElementById('audioBuzzerToggle');
  if (audioToggle) {
    audioToggle.addEventListener('change', (e) => {
      AppState.audioBuzzerEnabled = e.target.checked;
    });
  }

  // Initial runs
  fetchSensorTelemetry();
  fetchLiveWeather();

  // Periodic Telemetry Loop (Every 2.5s matching ESP32 hardware interval)
  setInterval(fetchSensorTelemetry, 2500);

  // Periodic Weather Refresh (Every 10 minutes)
  setInterval(fetchLiveWeather, 600000);
});
