import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
const WEATHER_ICONS = {
    'Clear': '☀️',
    'Clouds': '☁️',
    'Rain': '🌧️',
    'Snow': '🌨️',
    'Drizzle': '🌦️',
    'Thunderstorm': '⛈️',
    'Mist': '🌫️',
    'Fog': '🌫️'
};

const API_BASE = 'https://api.openweathermap.org/data/2.5/weather';

const calculateTimeDifference = (currentTime, targetTime, isNextDay = false) => {
    let [targetHour, targetMinute] = targetTime.split(':').map(Number);
    let currentHour = currentTime.get_hour();
    let currentMinute = currentTime.get_minute();
    let targetMinutes = targetHour * 60 + targetMinute;
    let currentMinutes = currentHour * 60 + currentMinute;
    if (isNextDay) {
        targetMinutes += 24 * 60;
    }

    let diffMinutes = targetMinutes - currentMinutes;
    return {
        hours: Math.floor(diffMinutes / 60),
        minutes: diffMinutes % 60
    };
};

function getPrayerMap() {
    return {
        'imsak': "İmsak",
        'gunes': "Güneş",
        'ogle': "Öğle",
        'ikindi': "İkindi",
        'aksam': "Akşam",
        'yatsi': "Yatsı"
    };
}
function loadCitiesData(extensionPath) {
    try {
        let citiesPath = GLib.build_filenamev([extensionPath, 'cities.json']);
        let [success, contents] = GLib.file_get_contents(citiesPath);
        let citiesJson = new TextDecoder().decode(contents);
        let data = JSON.parse(citiesJson);
        return data;
    } catch (error) {
        console.error('[Herkul] Şehirler yüklenirken hata oluştu:', error);
        return null;
    }
}

const PrayerTimesIndicator = GObject.registerClass(
class PrayerTimesIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Prayer Times Indicator');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._settingsChangedId = this._settings.connect('changed', this._onSettingsChanged.bind(this));
        this._isDestroyed = false;
        this._activeTimers = new Set();
        this._timeoutSource = null;
        this._prayerTimes = {};
        this._citiesData = loadCitiesData(this._extension.path);
        this._selectedCity = this._settings.get_string('default-city') || this._citiesData?.cities[0]?.name || "Istanbul";
        this._notificationsEnabled = this._settings.get_boolean('notify-enabled');
        this._soundEnabled = this._settings.get_boolean('sound-enabled');
        this._lastNotificationTime = null;
        this._isBlinking = false;
        this._isPlayingSound = false;
        this._player = null;
        this._retryCount = 0;
        this._maxRetries = 3;
        this._radioPlaying = false;
        this._radioPlayer = null;
        this._initHttpSession();
        try {
            this._icon = new St.Icon({
                gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', 'herkul.png'])),
                style_class: 'system-status-icon'
            });
        } catch (error) {
            console.error('[Herkul] Simge yüklenirken hata oluştu:', error);
            this._icon = new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'system-status-icon'
            });
        }
       
        this._weatherIcon = new St.Label({
            text: '🌤️',
            y_expand: true,
            y_align: 2
        });
        
        this._tempLabel = new St.Label({
            text: '',
            y_expand: true,
            y_align: 2
        });
    
        this._label = new St.Label({
            text: 'Loading...',
            y_expand: true,
            y_align: 2
        });
    
        this._fetchingIndicator = new St.Label({
            text: '⟳',
            y_expand: true,
            y_align: 2,
            style_class: 'loading-indicator',
            visible: false
        });
        
        this._cityLabel = new St.Label({
            text: this._selectedCity,
            y_expand: true,
            y_align: 2
        });
        
        this._fetchingIndicator = new St.Label({
            text: '⟳',
            y_expand: true,
            y_align: 2,
            style_class: 'loading-indicator',
            visible: false
        });
    
        let hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        hbox.add_child(this._icon);
        hbox.add_child(this._cityLabel);
        hbox.add_child(this._weatherIcon);
        hbox.add_child(this._tempLabel);
        hbox.add_child(this._label);
        hbox.add_child(this._fetchingIndicator);
        this.add_child(hbox);
        this._buildMenu();
        this._startUpdating();
    }
    _startRadio() {
        try {
           
            if (this._radioPlayer) {
                this._radioPlayer.set_state(Gst.State.NULL);
                this._radioPlayer = null;
            }
            
           
            if (this._radioWatcherId && GLib.source_remove(this._radioWatcherId)) {
                this._radioWatcherId = null;
            }
            
           
            Gst.init(null);
            this._radioPlayer = Gst.ElementFactory.make('playbin', 'radio');
            
            if (!this._radioPlayer) {
                throw new Error('GStreamer playbin oluşturulamadı');
            }
            
           
            
            this._radioPlayer.set_property('uri', 'https://play.radioking.io/herkulradyo');
           
            this._radioPlayer.set_property('buffer-size', 2097152);
            this._radioPlayer.set_property('buffer-duration', 5000000000);
            
           
            this._setupRadioStateMonitoring();
            
           
            this._radioPlayer.set_state(Gst.State.PLAYING);
            this._radioPlaying = true;
            
           
            this._radioWatcherId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                if (this._isDestroyed || !this._radioPlaying) {
                    return GLib.SOURCE_REMOVE;
                }
                this._checkRadioStatus();
                return GLib.SOURCE_CONTINUE;
            });
            
           
            if (this._radioWatcherId) {
                this._activeTimers.add(this._radioWatcherId);
            }
            
        } catch (error) {
            console.error(`[Herkul] Radyo başlatma hatası: ${error}`);
            this._radioPlaying = false;
        }
    }

    _checkRadioStatus() {
        if (!this._radioPlayer || !this._radioPlaying || this._isDestroyed) return false;
        
        try {
            const [ret, state, pending] = this._radioPlayer.get_state(0);
            if (state !== Gst.State.PLAYING && state !== Gst.State.PAUSED) {
                console.log(`[Herkul] Radyo durumu anormal: ${state}, yeniden başlatılıyor`);
                this._scheduleRadioRestart();
            }
        } catch (error) {
            console.error(`[Herkul] Durum kontrolü hatası: ${error.message}`);
        }
        return true;
    }


    _restartRadio() {
        if (!this._radioPlaying) return;
        
        console.log('[Herkul] Radyo yeniden başlatılıyor...');
        const restartTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
           
            const wasPlaying = this._radioPlaying;
            this._stopRadio();
            
            if (wasPlaying) {
               
                this._radioRetryCount = (this._radioRetryCount || 0) + 1;
                this._startRadio();
            }
            
            return GLib.SOURCE_REMOVE;
        });
        this._activeTimers.add(restartTimerId);
    }

    _scheduleRadioRestart() {
        if (!this._radioPlaying || this._isDestroyed) return;
        if (this._radioRestartTimerId) return;
        console.log('[Herkul] Radyo yeniden başlatma planlanıyor...');
        try {
           
            this._radioRestartTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                
                try {
                    const wasPlaying = this._radioPlaying;
                    this._stopRadio();
                    
                    if (wasPlaying) {
                       
                        this._radioRetryCount = (this._radioRetryCount || 0) + 1;
                        this._startRadio();
                    }
                } catch (e) {
                    console.error(`[Herkul] Yeniden başlatma hatası: ${e.message}`);
                }
                
                this._radioRestartTimerId = null;
                return GLib.SOURCE_REMOVE;
            });
            this._activeTimers.add(this._radioRestartTimerId);
            
        } catch (error) {
            console.error(`[Herkul] Yeniden başlatma planlama hatası: ${error.message}`);
        }
    }

    _setupRadioStateMonitoring() {
        if (!this._radioPlayer) return;
        try {
            const bus = this._radioPlayer.get_bus();
            if (this._radioBusWatch) {
                bus.remove_signal_watch();
                if (this._busMessageId) {
                    bus.disconnect(this._busMessageId);
                    this._busMessageId = null;
                }
            }
            
           
            bus.add_signal_watch();
            this._radioBusWatch = true;
            this._busMessageId = bus.connect('message', (bus, message) => {
                if (!this._radioPlayer || this._isDestroyed) return;
                
                try {
                    if (message.type === Gst.MessageType.ERROR) {
                        const [error, debug] = message.parse_error();
                        console.error(`[Herkul] GStreamer hatası: ${error.message} (${debug})`);
                        this._scheduleRadioRestart();
                    } 
                    else if (message.type === Gst.MessageType.EOS) {
                        console.log('[Herkul] Radyo akışı sona erdi');
                        this._scheduleRadioRestart();
                    }
                    else if (message.type === Gst.MessageType.STATE_CHANGED) {
                        if (message.src === this._radioPlayer) {
                            const [oldState, newState, pendingState] = message.parse_state_changed();
                            
                            if (newState === Gst.State.PLAYING) {
                                console.log('[Herkul] Radyo çalıyor');
                            } else if (newState === Gst.State.PAUSED) {
                                console.log('[Herkul] Radyo duraklatıldı');
                            }
                        }
                    }
                    else if (message.type === Gst.MessageType.BUFFERING) {
                        const percent = message.parse_buffering();
                        console.log(`[Herkul] Radyo tamponu: %${percent}`);
                        
                       
                        try {
                           
                            if (percent < 100) {
                               
                                const [ret, state, pending] = this._radioPlayer.get_state(0);
                                if (state === Gst.State.PLAYING) {
                                    this._radioPlayer.set_state(Gst.State.PAUSED);
                                }
                            } else {
                                this._radioPlayer.set_state(Gst.State.PLAYING);
                            }
                        } catch (e) {
                            console.error(`[Herkul] Tampon durum kontrolü hatası: ${e.message}`);
                        }
                    }
                } catch (e) {
                    console.error(`[Herkul] Bus mesajı işleme hatası: ${e.message}`);
                }
            });
            
        } catch (error) {
            console.error(`[Herkul] Bus izleme hatası: ${error.message}`);
        }
    }
    _toggleRadio() {
        if (this._radioPlaying) {
            this._stopRadio();
        } else {
            this._startRadio();
        }
    }
    _clearTimers() {
        for (let timerId of this._activeTimers) {
            GLib.source_remove(timerId);
        }
        this._activeTimers.clear();
    }
    _startUpdating() {
        if (this._isDestroyed) return;
        
        try {
            this._fetchPrayerTimes();
            this._fetchWeatherData();
            this._cleanupTimers();
            const prayerTimerId = this._addTimer(() => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            }, 60);
            const weatherTimerId = this._addTimer(() => {
                this._fetchWeatherData();
                return GLib.SOURCE_CONTINUE;
            }, 1800);
            this._activeTimers.add(prayerTimerId);
            this._activeTimers.add(weatherTimerId);
        } catch (error) {
            console.error(`[Herkul] Güncellemeler başlatılırken hata oluştu: ${error}`);
        }
    }

    _initHttpSession() {
        try {
            this._httpSession = new Soup.Session({
                timeout: 60,
                user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            });
            this._retryCount = 0;
        } catch (error) {
            console.error(`[Herkul] HTTP oturumu başlatılırken hata oluştu: ${error}`);
            if (this._retryCount < this._maxRetries) {
                this._retryCount++;
                const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                    this._initHttpSession();
                    return GLib.SOURCE_REMOVE;
                });
                this._activeTimers.add(timerId);
            }
        }
    }

    _showLoading() {
        if (this._fetchingIndicator) {
            try {
                this._fetchingIndicator.visible = true;
                if (this._fetchingIndicator instanceof St.Icon) {
                    this._fetchingIndicator.add_style_class_name('loading-indicator');
                }
            } catch (error) {
                console.error(`[Herkul] Yükleme göstergesi gösterilirken hata oluştu: ${error}`);
            }
        }
    }
    _hideLoading() {
        if (this._fetchingIndicator) {
            try {
                this._fetchingIndicator.visible = false;
                if (this._fetchingIndicator instanceof St.Icon) {
                    this._fetchingIndicator.remove_style_class_name('loading-indicator');
                }
            } catch (error) {
                console.error(`[Herkul] Yükleme göstergesi gizlenirken hata oluştu: ${error}`);
            }
        }
    }
    _stopRadio() {
        try {
           
            if (this._radioWatcherId) {
                try {
                    GLib.source_remove(this._radioWatcherId);
                    this._activeTimers.delete(this._radioWatcherId);
                    console.log('[Herkul] Radyo durduruldu');
                } catch (e) {
                    console.error(`[Herkul] Zamanlayıcı kaldırma bilgisi: ${e.message}`);
                }
                this._radioWatcherId = null;
            }
            if (this._radioBusWatch && this._radioPlayer) {
                try {
                    const bus = this._radioPlayer.get_bus();
                    bus.remove_signal_watch();
                    if (this._busMessageId) {
                        bus.disconnect(this._busMessageId);
                        this._busMessageId = null;
                    }
                } catch (e) {
                    console.error(`[Herkul] Bus kaldırma bilgisi: ${e.message}`);
                }
                this._radioBusWatch = false;
            }
            if (this._radioPlayer) {
                this._radioPlayer.set_state(Gst.State.NULL);
                this._radioPlayer = null;
            }
            this._radioPlaying = false;
        } catch (error) {
            console.error(`[Herkul] Radyo durdurma hatası: ${error}`);
        }
    }
    _onSettingsChanged(settings, key) {
        switch(key) {
            case 'default-city':
                this._selectedCity = this._settings.get_string('default-city');
                this._fetchPrayerTimes();
                this._fetchWeatherData();
                this._rebuildMenu();
                break;
            case 'notify-enabled':
                this._notificationsEnabled = this._settings.get_boolean('notify-enabled');
                break;
            case 'sound-enabled':
                this._soundEnabled = this._settings.get_boolean('sound-enabled');
                break;
            case 'apikey':
                this._fetchWeatherData();
                break;
        }
    }
    _updateLabels() {
       
        if (this._label) {
            this._label.text = _('Loading...');
        }
       
        this._updateDisplay();
    }
    _rebuildMenu() {
        this._buildMenu();
    }
    _buildMenu() {
        this.menu.removeAll();
        if (!this._citiesData) {
            console.debug('[Herkul] Şehir verisi mevcut değil');
            return;
        }
        let prayerNames = getPrayerMap();
        if (this._prayerTimes && Object.keys(this._prayerTimes).length > 0) {
            Object.entries(this._prayerTimes).forEach(([name, time]) => {
                let prayerName = prayerNames[name];
                let menuItem = new PopupMenu.PopupMenuItem(`${prayerName}: ${time}`);
                this.menu.addMenuItem(menuItem);
                this._updateWeatherMenu();
            });
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        let radioBox = new St.BoxLayout({ style_class: 'popup-menu-item' });
        let radioIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', 'herkul.png'])),
            style_class: 'popup-menu-icon',
            icon_size: 16
        });
        let radioItem = new PopupMenu.PopupSwitchMenuItem(_('Herkul Radio'), this._radioPlaying);
        radioItem.insert_child_at_index(radioIcon, 1);
        radioItem.connect('toggled', () => {
            this._toggleRadio();
        });
        this.menu.addMenuItem(radioItem);
        
        let cityItem = new PopupMenu.PopupSubMenuMenuItem(_("Şehir Seçin"));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._citiesData.cities.forEach(city => {
            let item = new PopupMenu.PopupMenuItem(city.name);
            if (city.name === this._selectedCity) {
                item.setOrnament(PopupMenu.Ornament.DOT);
            }
            item.connect('activate', () => {
                this._selectedCity = city.name;
                this._settings.set_string('default-city', city.name);
                this._fetchPrayerTimes();
                this._rebuildMenu();
            });
            cityItem.menu.addMenuItem(item);
        });
        this.menu.addMenuItem(cityItem);        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const settingsButton = new PopupMenu.PopupMenuItem(_('Ayarlar'));
        settingsButton.connect('activate', () => {
            if (this._extension) {
                this._extension.openPreferences();
            }
        });
        this.menu.addMenuItem(settingsButton);
    }
    async _fetchWeatherData() {
        const apiKey = this._settings.get_string('apikey');
        if (!apiKey) return;
        const cityData = this._citiesData.cities.find(city => city.name === this._selectedCity);
        if (!cityData?.weatherId) return;
        try {
            const url = `${API_BASE}?id=${cityData.weatherId}&appid=${apiKey}&units=metric`;
            let message = Soup.Message.new('GET', url);
            let bytes = await this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.status_code === 200) {
                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                this._updateWeatherDisplay(data);
            }
        } catch (error) {
            console.error('[Herkul] Hava durumu hatası:', error);
        }
    }
    _updateWeatherDisplay(data) {
        if (!data?.weather?.[0] || this._isDestroyed) return;
        try {
            const weather = data.weather[0];
            const temp = Math.round(data.main.temp);
            const icon = WEATHER_ICONS[weather.main] || '🌤️';
            if (this._weatherIcon?.get_parent()) {
                this._weatherIcon.text = icon;
            }
            if (this._tempLabel?.get_parent()) {
                this._tempLabel.text = `${temp}°C`;
            }
        } catch (error) {
            console.error('[Herkul] Ekran güncelleme hatası:', error);
        }
    }
    _updateWeatherMenu() {
        if (!this._weatherData?.weather?.[0]) return;
        const weather = this._weatherData.weather[0];
        const temp = Math.round(this._weatherData.main.temp);
        const feelsLike = Math.round(this._weatherData.main.feels_like);
        const humidity = this._weatherData.main.humidity;
        const windSpeed = this._weatherData.wind.speed;
        const weatherItem = new PopupMenu.PopupMenuItem(`${weather.description}`);
        const tempItem = new PopupMenu.PopupMenuItem(`Temperature: ${temp}°C (Feels like: ${feelsLike}°C)`);
        const humidityItem = new PopupMenu.PopupMenuItem(`Humidity: ${humidity}%`);
        const windItem = new PopupMenu.PopupMenuItem(`Wind: ${windSpeed} m/s`);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(weatherItem);
        this.menu.addMenuItem(tempItem);
        this.menu.addMenuItem(humidityItem);
        this.menu.addMenuItem(windItem);
    }
    async _fetchPrayerTimes() {
        if (!this._citiesData) {
            console.debug('[Herkul] Şehir verisi mevcut değil');
            return;
        }
        let cityData = this._citiesData.cities.find(city => city.name === this._selectedCity);
        if (!cityData) {
            console.warn(`[Herkul] Şehir bulunamadı: ${this._selectedCity}`);
            return;
        }
        this._showLoading();
        try {
            if (!this._httpSession) {
                console.debug('[Herkul] HTTP oturumu başlatılmadı, yeniden deneniyor...');
                this._initHttpSession();
                return;
            }
            let message = new Soup.Message({
                method: 'GET',
                uri: GLib.Uri.parse(cityData.url, GLib.UriFlags.NONE)
            });
            message.request_headers.append('Accept', 'text/html,application/xhtml+xml');
            message.request_headers.append('Accept-Language', 'tr-TR,tr');
            message.request_headers.append('Cache-Control', 'no-cache');
            let bytes = await this._httpSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null
            );
            if (message.status_code !== 200) {
                throw new Error(`HTTP error: ${message.status_code}`);
            }
            let text = new TextDecoder().decode(bytes.get_data());
            const timeRegex = /<div class="tpt-cell" data-vakit-name="([^"]+)"[^>]*>[\s\S]*?<div class="tpt-time">(\d{2}:\d{2})<\/div>/g;
            let times = {};
            let match;
            while ((match = timeRegex.exec(text)) !== null) {
                const [_, name, time] = match;
                times[name] = time;
            }
            if (Object.keys(times).length === 0) {
                throw new Error('Cevapta namaz vakitleri bulunamadı');
            }
            this._prayerTimes = times;
            this._updateDisplay();
            this._hideLoading();
        } catch (error) {
            console.error(`[Herkul] Namaz vakitleri alınırken hata oluştu: ${error}`);
            this._hideLoading();
            if (error.message.includes('not initialized') || error.message.includes('Xwayland')) {
                if (this._retryCount < this._maxRetries) {
                    this._retryCount++;
                    const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                        this._fetchPrayerTimes();
                        return GLib.SOURCE_REMOVE;
                    });
                    this._activeTimers.add(timerId);
                }
            }
            this._label.text = 'Namaz vakitleri yüklenemedi';
        }
    }

    _updateDisplay() {
        if (this._isDestroyed) return;

        if (this._cityLabel && !this._cityLabel.is_finalized?.()) {
            this._cityLabel.text = this._selectedCity;
        }
        const nextPrayer = this._findNextPrayer();
        if (!nextPrayer) return;
        try {
            const timeInfo = this._calculateTimeLeft(nextPrayer.time, nextPrayer.isNextDay);
            
            if (this._label && !this._label.is_finalized?.()) {
                this._label.text = `${nextPrayer.name}: ${timeInfo.hours}h ${timeInfo.minutes}m`;
                
                if (timeInfo.totalMinutes >= 15 && timeInfo.totalMinutes <= 20) {
                    this._showNotification(nextPrayer.name, timeInfo.totalMinutes);
                }
            }
        } catch (error) {
            console.error('[Herkul] Ekran güncelleme hatası:', error);
            if (this._label && !this._label.is_finalized?.()) {
                this._label.text = 'Error';
            }
        }
    }
    _cleanupTimers() {
        if (this._timeoutSource) {
            GLib.source_remove(this._timeoutSource);
            this._timeoutSource = null;
        }
        
        if (this._activeTimers) {
            this._activeTimers.forEach(timerId => {
                try {
                    GLib.source_remove(timerId);
                } catch (error) {
                    console.error(`[Herkul] Zamanlayıcı kaldırılırken hata oluştu ${timerId}: ${error}`);
                }
            });
            this._activeTimers.clear();
        }
    }
    _cleanupUI() {
        ['_label', '_icon', '_fetchingIndicator', '_weatherIcon', '_tempLabel', '_cityLabel'].forEach(widgetName => {
            if (this[widgetName] && !this[widgetName].is_finalized?.()) {
                try {
                    this[widgetName].destroy();
                } catch (error) {
                    console.error(`[Herkul] Hata yok etme ${widgetName}:`, error);
                }
                this[widgetName] = null;
            }
        });
    }
    _findNextPrayer() {
        if (!this._prayerTimes || Object.keys(this._prayerTimes).length === 0) {
            return null;
        }
        let currentTime = GLib.DateTime.new_now_local();
        let currentTimeString = currentTime.format('%H:%M');
        let prayers = Object.entries(this._prayerTimes);
        let prayerNames = getPrayerMap();
        for (let [name, time] of prayers) {
            if (time > currentTimeString) {
                return {name: prayerNames[name], time, isNextDay: false};
            }
        }
        let firstPrayer = prayers[0];
        return {
            name: prayerNames[firstPrayer[0]],
            time: firstPrayer[1],
            isNextDay: true
        };
    }
    _calculateTimeLeft(prayerTime, isNextDay = false) {
        let currentTime = GLib.DateTime.new_now_local();
        let diff = calculateTimeDifference(currentTime, prayerTime, isNextDay);
        let totalMinutes = diff.hours * 60 + diff.minutes;
        return {
            hours: diff.hours,
            minutes: diff.minutes,
            totalMinutes: totalMinutes,
            formatted: `${diff.hours}h ${diff.minutes}m`
        };
    }
    _showNotification(prayerName, minutesLeft) {
        if (!this._notificationsEnabled) return;
        if (minutesLeft < 15 || minutesLeft > 20) {
            return;
        }
        let currentTime = GLib.DateTime.new_now_local();
        if (this._lastNotificationTime) {
            let timeSinceLastNotification = Math.floor(
                currentTime.difference(this._lastNotificationTime) / 1000 / 60
            );
            if (timeSinceLastNotification < 240) {
                return;
            }
        }
        this._lastNotificationTime = currentTime;
        if (!this._isBlinking) {
            this._isBlinking = true;
            this._icon.style_class = 'system-status-icon blink';
            const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                if (this._icon) {
                    this._icon.style_class = 'system-status-icon';
                    this._isBlinking = false;
                }
                return GLib.SOURCE_REMOVE;
            });
            this._activeTimers.add(timerId);
        }
        if (this._soundEnabled && !this._isPlayingSound) {
            try {
                this._isPlayingSound = true;
                const soundPath = GLib.build_filenamev([this._extension.path, 'sounds', 'call.mp3']);
                const soundFile = Gio.File.new_for_path(soundPath);
                if (soundFile.query_exists(null)) {
                    Gst.init(null);
                    this._player = Gst.ElementFactory.make('playbin', 'player');
                    if (this._player) {
                        const uri = soundFile.get_uri();
                        this._player.set_property('uri', uri);
                        this._player.set_state(Gst.State.PLAYING);
                        const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                            if (this._player) {
                                this._player.set_state(Gst.State.NULL);
                                this._player = null;
                            }
                            this._isPlayingSound = false;
                            return GLib.SOURCE_REMOVE;
                        });
                        this._activeTimers.add(timerId);
                    }
                }
            } catch (error) {
                console.error(`[Herkul] Ses çalınırken hata oluştu: ${error}`);
                this._isPlayingSound = false;
            }
        }
    }
    _addTimer(callback, interval) {
        if (this._isDestroyed) {
            return null;
        }
        try {
            const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
                if (this._isDestroyed) {
                    return GLib.SOURCE_REMOVE;
                }
                return callback();
            });
            this._activeTimers.add(timerId);
            return timerId;
        } catch (error) {
            console.error(`[Herkul] Zamanlayıcı eklenirken hata oluştu: ${error}`);
            return null;
        }
    }
    _startUpdating() {
        if (this._isDestroyed) {
            return;
        }
        try {
            this._fetchPrayerTimes();
            this._cleanupTimers();
            const timerId = this._addTimer(() => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            }, 60);
            this._activeTimers.add(timerId);
        } catch (error) {
            console.error(`[Herkul] Güncellemeler başlatılırken hata oluştu: ${error}`);
        }
    }
    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._isDestroyed = true;
        if (this._radioWatcherId) {
            try {
                GLib.source_remove(this._radioWatcherId);
            } catch (e) {
               
            }
            this._radioWatcherId = null;
        }
        if (this._radioRestartTimerId) {
            try {
                GLib.source_remove(this._radioRestartTimerId);
            } catch (e) {
               
            }
            this._radioRestartTimerId = null;
        }
        if (this._radioBusWatch && this._radioPlayer) {
            try {
                const bus = this._radioPlayer.get_bus();
                bus.remove_signal_watch();
                
                if (this._busMessageId) {
                    bus.disconnect(this._busMessageId);
                    this._busMessageId = null;
                }
            } catch (e) {
            }
            this._radioBusWatch = false;
        }
        if (this._radioPlayer) {
            this._radioPlayer.set_state(Gst.State.NULL);
            this._radioPlayer = null;
        }
        this._cleanupTimers();
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._cleanupUI();
        this._prayerTimes = {};
        this._isPlayingSound = false;
        this._isBlinking = false;
        super.destroy();
    }
});
export default class PrayerTimesExtension extends Extension {
    enable() {
        console.debug('[Herkul] Uzantıyı etkinleştirme');
        this._indicator = new PrayerTimesIndicator(this);
        Main.panel.addToStatusArea('prayer-times', this._indicator);
    }
    disable() {
        console.debug('[Herkul] Uzantı devre dışı bırakılıyor');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}