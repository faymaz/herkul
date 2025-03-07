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
        'imsak': _("Fajr"),
        'gunes': _("Sunrise"),
        'ogle': _("Dhuhr"),
        'ikindi': _("Asr"),
        'aksam': _("Maghrib"),
        'yatsi': _("Isha")
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
        console.error('[PrayerTimes] Error loading cities:', error);
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
        
        // Get initial settings
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
            console.error('[PrayerTimes] Error loading icon:', error);
            this._icon = new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'system-status-icon'
            });
        }
        // this._label.text = _("Loading...");
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
        // hbox.add_child(this._icon);
        // hbox.add_child(this._cityLabel);
        // hbox.add_child(this._label);
        // hbox.add_child(this._weatherIcon);
        // hbox.add_child(this._tempLabel);
        // hbox.add_child(this._fetchingIndicator);
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
    
    // _toggleRadio() {
    //     if (this._radioPlaying) {
    //         if (this._radioPlayer) {
    //             this._radioPlayer.set_state(Gst.State.NULL);
    //             this._radioPlayer = null;
    //         }
    //         this._radioPlaying = false;
    //     } else {
    //         try {
    //             Gst.init(null);
    //             this._radioPlayer = Gst.ElementFactory.make('playbin', 'radio');
    //             if (this._radioPlayer) {
    //                 this._radioPlayer.set_property('uri', 'https://s1.wohooo.net/proxy/herkulfo/stream');
    //                 this._radioPlayer.set_state(Gst.State.PLAYING);
    //                 this._radioPlaying = true;
    //             }
    //         } catch (error) {
    //             console.error(`[PrayerTimes] Radio error: ${error}`);
    //         }
    //     }
    // }


    _startRadio() {
        try {
            // Önceki player'ı temizle
            if (this._radioPlayer) {
                this._radioPlayer.set_state(Gst.State.NULL);
                this._radioPlayer = null;
            }
            
            // Sinyal takip mekanizması varsa temizle
            if (this._radioWatcherId) {
                GLib.source_remove(this._radioWatcherId);
                this._radioWatcherId = null;
            }
            
            // GStreamer başlat
            Gst.init(null);
            this._radioPlayer = Gst.ElementFactory.make('playbin', 'radio');
            
            if (!this._radioPlayer) {
                throw new Error('GStreamer playbin oluşturulamadı');
            }
            
            // Akış URL'si (ana ve yedek URL'ler)
            const primaryUrl = 'https://s1.wohooo.net/proxy/herkulfo/stream';
            const backupUrl = 'https://s1.wohooo.net:8100/stream'; // Yedek URL (eğer varsa)
            
            // Ana URL ile başla
            this._radioPlayer.set_property('uri', primaryUrl);

            // this._radioPlayer.set_property('buffer-size', 2097152); // 2MB buffer
            // this._radioPlayer.set_property('buffer-duration', 5000000000); // 5 saniye buffer
            
            // Radyo durumunu izleme
            this._setupRadioStateMonitoring();
            
            // Başlat
            this._radioPlayer.set_state(Gst.State.PLAYING);
            this._radioPlaying = true;
            
            // Periyodik olarak radyo durumunu kontrol et (her 30 saniyede bir)
            this._radioWatcherId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                this._checkRadioStatus();
                return GLib.SOURCE_CONTINUE; // Devam et
            });
            
            // Bu timeout ID'sini aktif zamanlayıcılar listesine ekle
            this._activeTimers.add(this._radioWatcherId);
            
        } catch (error) {
            console.error(`[Herkul] Radyo başlatma hatası: ${error}`);
            this._radioPlaying = false;
        }
    }

    _checkRadioStatus() {
        if (!this._radioPlayer || !this._radioPlaying) return false;
        
        // Radyonun durumunu kontrol et
        let [ret, state, pending] = this._radioPlayer.get_state(Gst.CLOCK_TIME_NONE);
        
        // Eğer radyo PLAYING durumunda değilse ve bağlantı sorunu varsa
        if (state !== Gst.State.PLAYING && state !== Gst.State.PAUSED) {
            console.log(`[Herkul] Radyo durumu anormal: ${state}, yeniden başlatılıyor`);
            this._restartRadio();
        }
        
        return true; // Zamanlayıcıyı sürdür
    }


    _restartRadio() {
        if (!this._radioPlaying) return;
        
        console.log('[Herkul] Radyo yeniden başlatılıyor...');
        
        // Kısa bir gecikme ile yeniden başlat
        const restartTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            // Durumu koruyarak yeniden başlat
            const wasPlaying = this._radioPlaying;
            this._stopRadio();
            
            if (wasPlaying) {
                // Alternatif URL dene
                this._radioRetryCount = (this._radioRetryCount || 0) + 1;
                this._startRadio();
            }
            
            return GLib.SOURCE_REMOVE; // Bir kez çalış
        });
        
        // Zamanlayıcıyı izle
        this._activeTimers.add(restartTimerId);
    }


    _setupRadioStateMonitoring() {
        if (!this._radioPlayer) return;
        
        // GStreamer bus sinyallerini dinle
        const bus = this._radioPlayer.get_bus();
        
        // Bus watch ID'sini saklayalım ki daha sonra temizleyebilelim
        if (this._radioBusWatchId) {
            bus.remove_watch(this._radioBusWatchId);
        }
        
        this._radioBusWatchId = bus.add_watch(GLib.PRIORITY_DEFAULT, (bus, message) => {
            if (message.type === Gst.MessageType.ERROR) {
                const [error, debug] = message.parse_error();
                console.error(`[Herkul] GStreamer hatası: ${error.message} (${debug})`);
                
                // Radyo akışını yeniden başlatmayı dene
                this._restartRadio();
            } 
            else if (message.type === Gst.MessageType.EOS) {
                console.log('[Herkul] Radyo akışı sona erdi, yeniden başlatılıyor');
                this._restartRadio();
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
            
            return true; // Sinyal izlemeye devam et
        });
    }

    _stopRadio() {
        try {
            // Durumu izleme zamanlayıcısını temizle
            if (this._radioWatcherId) {
                GLib.source_remove(this._radioWatcherId);
                this._radioWatcherId = null;
                this._activeTimers.delete(this._radioWatcherId);
            }
            
            // Player'ı durdur
            if (this._radioPlayer) {
                this._radioPlayer.set_state(Gst.State.NULL);
                this._radioPlayer = null;
            }
            
            this._radioPlaying = false;
            
        } catch (error) {
            console.error(`[Herkul] Radyo durdurma hatası: ${error}`);
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
            
            // Namaz vakitleri için timer (1 dakika)
            const prayerTimerId = this._addTimer(() => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            }, 60);
            
            // Hava durumu için timer (30 dakika)
            const weatherTimerId = this._addTimer(() => {
                this._fetchWeatherData();
                return GLib.SOURCE_CONTINUE;
            }, 1800);
            
            this._activeTimers.add(prayerTimerId);
            this._activeTimers.add(weatherTimerId);
        } catch (error) {
            console.error(`[Herkul] Error starting updates: ${error}`);
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
            console.error(`[PrayerTimes] Error initializing HTTP session: ${error}`);
            if (this._retryCount < this._maxRetries) {
                this._retryCount++;
                const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                    this._initHttpSession();
                    return GLib.SOURCE_REMOVE;
                });
                this._activeTimers.add(timerId); // Track the timeout
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
                console.error(`[PrayerTimes] Error showing loading indicator: ${error}`);
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
                console.error(`[PrayerTimes] Error hiding loading indicator: ${error}`);
            }
        }
    }

    _loadTranslations(lang) {
        try {
            let locale = lang || 'en';
            GLib.setenv('LANGUAGE', locale, true);
        } catch (e) {
            console.error('[Herkul] Error loading translations:', e);
        }
    }

    _onSettingsChanged(settings, key) {
        switch(key) {
            case 'language':
            case 'default-city':
                this._selectedCity = this._settings.get_string('default-city');
                this._fetchPrayerTimes();
                this._fetchWeatherData(); // Hava durumunu güncelle
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
        // Tüm statik metinleri güncelle
        if (this._label) {
            this._label.text = _('Loading...');
        }
        // Vakitleri güncelle
        this._updateDisplay();
    }

    _rebuildMenu() {
        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();
        if (!this._citiesData) {
            console.debug('[PrayerTimes] No cities data available');
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
        
        let cityItem = new PopupMenu.PopupSubMenuMenuItem(_("Select City"));
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
        // Add language submenu
        let langItem = new PopupMenu.PopupSubMenuMenuItem(_("Language"));
        
        const languages = [
            { id: 'en', name: 'English' },
            { id: 'tr', name: 'Türkçe' },
            { id: 'de', name: 'Deutsch' },
            { id: 'ar', name: 'العربية' }
        ];

        languages.forEach(lang => {
            let item = new PopupMenu.PopupMenuItem(lang.name);
            if (this._settings.get_string('language') === lang.id) {
                item.setOrnament(PopupMenu.Ornament.DOT);
            }
            item.connect('activate', () => {
                this._settings.set_string('language', lang.id);
                this._loadTranslations(lang.id);
                this._rebuildMenu();
            });
            langItem.menu.addMenuItem(item);
        });

        this.menu.addMenuItem(langItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings button at the end
        const settingsButton = new PopupMenu.PopupMenuItem(_('Settings'));
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
            console.error('[Herkul] Weather error:', error);
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
            console.error('[Herkul] Display update error:', error);
        }
    }

    _updateWeatherMenu() {
        if (!this._weatherData?.weather?.[0]) return;
    
        const weather = this._weatherData.weather[0];
        const temp = Math.round(this._weatherData.main.temp);
        const feelsLike = Math.round(this._weatherData.main.feels_like);
        const humidity = this._weatherData.main.humidity;
        const windSpeed = this._weatherData.wind.speed;
    
        // Hava durumu menüsü
        const weatherItem = new PopupMenu.PopupMenuItem(`${weather.description}`);
        const tempItem = new PopupMenu.PopupMenuItem(`Temperature: ${temp}°C (Feels like: ${feelsLike}°C)`);
        const humidityItem = new PopupMenu.PopupMenuItem(`Humidity: ${humidity}%`);
        const windItem = new PopupMenu.PopupMenuItem(`Wind: ${windSpeed} m/s`);
    
        // Namaz vakitlerinden sonra ekle
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(weatherItem);
        this.menu.addMenuItem(tempItem);
        this.menu.addMenuItem(humidityItem);
        this.menu.addMenuItem(windItem);
    }
    

    async _fetchPrayerTimes() {
        if (!this._citiesData) {
            console.debug('[PrayerTimes] No cities data available');
            return;
        }
    
        let cityData = this._citiesData.cities.find(city => city.name === this._selectedCity);
        if (!cityData) {
            console.warn(`[PrayerTimes] City not found: ${this._selectedCity}`);
            return;
        }
        
        this._showLoading();
        
        try {
            if (!this._httpSession) {
                console.debug('[PrayerTimes] HTTP session not initialized, retrying...');
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
                throw new Error('No prayer times found in response');
            }
    
            this._prayerTimes = times;
            this._updateDisplay();
            this._hideLoading();
        } catch (error) {
            console.error(`[PrayerTimes] Error fetching prayer times: ${error}`);
            this._hideLoading();
            if (error.message.includes('not initialized') || error.message.includes('Xwayland')) {
                if (this._retryCount < this._maxRetries) {
                    this._retryCount++;
                    const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                        this._fetchPrayerTimes();
                        return GLib.SOURCE_REMOVE;
                    });
                    this._activeTimers.add(timerId); // Track the timeout
                }
            }
            this._label.text = 'Failed to load prayer times';
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
            console.error('[PrayerTimes] Display update error:', error);
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
                    console.error(`[PrayerTimes] Error removing timer ${timerId}: ${error}`);
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
                    console.error(`[Herkul] Error destroying ${widgetName}:`, error);
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
        let prayerNames = getPrayerMap(); // Her seferinde güncel çevirileri al
        
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
            this._activeTimers.add(timerId); // Track the timeout
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
                        this._activeTimers.add(timerId); // Track the timeout
                    }
                }
            } catch (error) {
                console.error(`[PrayerTimes] Error playing sound: ${error}`);
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
            console.error(`[PrayerTimes] Error adding timer: ${error}`);
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
            this._activeTimers.add(timerId); // Track the timeout
        } catch (error) {
            console.error(`[PrayerTimes] Error starting updates: ${error}`);
        }
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        
        this._isDestroyed = true;
        
        // Clear all timeouts
        this._cleanupTimers();
        
        // Cleanup HTTP session
        if (this._httpSession) {
            this._httpSession.abort();
            this._httpSession = null;
        }
        
        // Cleanup radio player
        // if (this._radioPlayer) {
        //     this._radioPlayer.set_state(Gst.State.NULL);
        //     this._radioPlayer = null;
        // }

        // Radio ile ilgili ek kaynakları temizle
        if (this._radioWatcherId) {
            GLib.source_remove(this._radioWatcherId);
            this._radioWatcherId = null;
        }
        
        if (this._radioBusWatchId && this._radioPlayer) {
            const bus = this._radioPlayer.get_bus();
            bus.remove_watch(this._radioBusWatchId);
            this._radioBusWatchId = null;
        }
        
        // Mevcut destroy işlemine devam et
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        // Cleanup UI elements
        this._cleanupUI();

        this._prayerTimes = {};
        this._isPlayingSound = false;
        this._isBlinking = false;

        super.destroy();
    }
});

export default class PrayerTimesExtension extends Extension {
    enable() {
        console.debug('[PrayerTimes] Enabling extension');
        this._indicator = new PrayerTimesIndicator(this);
        Main.panel.addToStatusArea('prayer-times', this._indicator);
    }

    disable() {
        console.debug('[PrayerTimes] Disabling extension');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}