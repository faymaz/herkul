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
const ALADHAN_API_BASE = 'http://api.aladhan.com/v1/timings';
const calculateTimeDifference = (currentTime, targetTime, isNextDay = false) => {
    let [targetHour, targetMinute] = targetTime.split(':').map(Number);
    let currentHour = currentTime.get_hour();
    let currentMinute = currentTime.get_minute();
    let currentSecond = currentTime.get_second();
    let targetSeconds = (targetHour * 60 + targetMinute) * 60;
    let currentSeconds = (currentHour * 60 + currentMinute) * 60 + currentSecond;
    
    if (isNextDay) {
        targetSeconds += 24 * 60 * 60;
    }

    let diffSeconds = targetSeconds - currentSeconds;
    
    let hours = Math.floor(diffSeconds / 3600);
    let remainingSeconds = diffSeconds % 3600;
    let minutes = Math.floor(remainingSeconds / 60);
    let seconds = remainingSeconds % 60;
    
    return {
        hours: hours,
        minutes: minutes,
        seconds: seconds,
        totalMinutes: Math.floor(diffSeconds / 60),
        totalSeconds: diffSeconds
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

       
        this._debug = (message) => {
            if (this._settings.get_boolean('debug-enabled')) {
                console.log(`[Herkul] ${message}`);
            }
        };

        this._debug('Extension başlatılıyor...');
        this._settingsChangedId = this._settings.connect('changed', this._onSettingsChanged.bind(this));
        this._isDestroyed = false;
        this._debug('Extension ayarları yüklendi');
        this._activeTimers = new Set();
        this._timeoutSource = null;
        this._prayerTimes = {};
        this._calendarInfo = { hijri: null, gregorian: null };
        this._citiesData = loadCitiesData(this._extension.path);

       
        let defaultCity = this._settings.get_string('default-city');
        if (!defaultCity && this._citiesData && this._citiesData.cities) {
           
            for (const countryData of this._citiesData.cities) {
                if (countryData.cities && Array.isArray(countryData.cities) && countryData.cities.length > 0) {
                    defaultCity = countryData.cities[0].name;
                    break;
                }
            }
        }
        this._selectedCity = defaultCity || "Istanbul";
        this._notificationsEnabled = this._settings.get_boolean('notify-enabled');
        this._soundEnabled = this._settings.get_boolean('sound-enabled');
        this._ezanEnabled = this._settings.get_boolean('ezan-enabled');
        this._lastNotificationTime = null;
        this._lastEzanPrayer = null;
        this._isBlinking = false;
        this._isPlayingSound = false;
        this._isPlayingEzan = false;
        this._player = null;
        this._ezanPlayer = null;
        this._retryCount = 0;
        this._maxRetries = 3;
        this._radioPlaying = false;
        this._radioPlayer = null;
        this._initHttpSession();
        this._radioStations = [
            {
                id: 'herkul',
                name: _("Herkul Radyo"),
                icon: 'herkul.png',
                urls: [
                    'https://play.radioking.io/herkulradyo',
                    'https://listen.radioking.com/radio/721190/stream/787034'
                ]
            },
            {
                id: 'cihan',
                name: _("Cihan Radyo"),
                icon: 'cihan.png',
                urls: [
                    'https://listen.radioking.com/radio/301204/stream/347869'
                ]
            },
            {
                id: 'sadecemuzik',
                name: _("Sadece Müzik"),
                icon: 'cihan_muzik.jpg',
                urls: [
                    'https://listen.radioking.com/radio/605425/stream/666847'
                ]
            }
        ];
        this._currentStation = this._settings.get_string('current-station') || 'herkul';
        this._currentStationIndex = this._radioStations.findIndex(station => station.id === this._currentStation);
        if (this._currentStationIndex === -1) this._currentStationIndex = 0;
        this._currentUrlIndex = 0;
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
    _findCityByName(cityName) {
        if (!this._citiesData || !this._citiesData.cities) {
            return null;
        }

        for (const countryData of this._citiesData.cities) {
            if (countryData.cities && Array.isArray(countryData.cities)) {
                const city = countryData.cities.find(c => c.name === cityName);
                if (city) {
                    return city;
                }
            }
        }
        return null;
    }
    _getFirstCity() {
        if (!this._citiesData || !this._citiesData.cities) {
            return "Istanbul";
        }

        for (const countryData of this._citiesData.cities) {
            if (countryData.cities && Array.isArray(countryData.cities) && countryData.cities.length > 0) {
                return countryData.cities[0].name;
            }
        }
        return "Istanbul";
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
            
           
            const currentStation = this._radioStations[this._currentStationIndex];
            if (!currentStation) {
                throw new Error('Radyo istasyonu bulunamadı');
            }
            
           
            const url = currentStation.urls[this._currentUrlIndex] || currentStation.urls[0];
            
            this._radioPlayer.set_property('uri', url);
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
            this._tryNextUrl();
        }
    }

    _tryNextUrl() {
        const currentStation = this._radioStations[this._currentStationIndex];
        if (!currentStation) return;
        
       
        this._currentUrlIndex = (this._currentUrlIndex + 1) % currentStation.urls.length;
        
       
        if (this._currentUrlIndex === 0) {
            this._debug('Tüm URL\'ler başarısız oldu');
            this._radioPlaying = false;
            return;
        }

       
        this._debug(`Yeni URL deneniyor: ${this._currentUrlIndex}`);
        const retryTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
            if (this._radioPlaying) {
                this._startRadio();
            }
            return GLib.SOURCE_REMOVE;
        });
        this._activeTimers.add(retryTimer);
    }
    _checkRadioStatus() {
        if (!this._radioPlayer || !this._radioPlaying || this._isDestroyed) return false;
        
        try {
            const [ret, state, pending] = this._radioPlayer.get_state(0);
            if (state !== Gst.State.PLAYING && state !== Gst.State.PAUSED) {
                console.log(`[Herkul] Radyo durumu anormal: ${state}, yeniden başlatılıyor`);
                this._scheduleRadioRestart();
                this._tryNextUrl();
            }
        } catch (error) {
            console.error(`[Herkul] Durum kontrolü hatası: ${error.message}`);
        }
        return true;
    }
    _restartRadio() {
        if (!this._radioPlaying) return;

        this._debug('Radyo yeniden başlatılıyor...');
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
        this._debug('Radyo yeniden başlatma planlanıyor...');
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
                        this._tryNextUrl();
                    }
                    else if (message.type === Gst.MessageType.EOS) {
                        this._debug('Radyo akışı sona erdi');
                        this._scheduleRadioRestart();
                    }
                    else if (message.type === Gst.MessageType.STATE_CHANGED) {
                        if (message.src === this._radioPlayer) {
                            const [oldState, newState, pendingState] = message.parse_state_changed();

                            if (newState === Gst.State.PLAYING) {
                                this._debug('Radyo çalıyor');
                            } else if (newState === Gst.State.PAUSED) {
                                this._debug('Radyo duraklatıldı');
                            }
                        }
                    }
                    else if (message.type === Gst.MessageType.BUFFERING) {
                        const percent = message.parse_buffering();
                        this._debug(`Radyo tamponu: %${percent}`);
                        
                       
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
    _changeStation(stationId) {
        if (this._isDestroyed) return;
        
        const stationIndex = this._radioStations.findIndex(station => station.id === stationId);
        if (stationIndex === -1) return;
        
        this._currentStationIndex = stationIndex;
        this._currentStation = stationId;
        this._currentUrlIndex = 0;
        this._settings.set_string('current-station', stationId);
        
        if (this._radioPlaying) {
            this._stopRadio();
            const restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._startRadio();
                return GLib.SOURCE_REMOVE;
            });
            this._activeTimers.add(restartTimer);
        }
        
        this._rebuildMenu();
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
        this._debug('_startUpdating çağrıldı');
        if (this._isDestroyed) return;

        try {
            this._debug('Namaz vakitleri ve hava durumu bilgileri getiriliyor...');
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
    this._httpSession = new Soup.Session({
        timeout: 30,
        user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0'
    });
   
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
                    this._debug('Radyo durduruldu');
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
            case 'ezan-enabled':
                this._ezanEnabled = this._settings.get_boolean('ezan-enabled');
                break;
            case 'apikey':
                this._fetchWeatherData();
                break;
            case 'current-station':
                const stationId = this._settings.get_string('current-station');
                if (stationId !== this._currentStation) {
                    this._changeStation(stationId);
                }
                break;
            case 'notification-sound':
                this._debug(`Bildirim sesi değiştirildi: ${this._settings.get_string('notification-sound')}`);
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

       
        if (this._calendarInfo) {
            if (this._calendarInfo.gregorian) {
                let gregorianItem = new PopupMenu.PopupMenuItem(this._calendarInfo.gregorian, {
                    reactive: false,
                    style_class: 'calendar-info-gregorian'
                });
                this.menu.addMenuItem(gregorianItem);
            }

            if (this._calendarInfo.hijri) {
                let hijriItem = new PopupMenu.PopupMenuItem(this._calendarInfo.hijri, {
                    reactive: false,
                    style_class: 'calendar-info-hijri'
                });
                this.menu.addMenuItem(hijriItem);
            }

            if (this._calendarInfo.gregorian || this._calendarInfo.hijri) {
                this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            }
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
        
       
        let radioMenu = new PopupMenu.PopupSubMenuMenuItem(_('Radyo İstasyonları'));
        this._radioStations.forEach(station => {
            let stationIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', station.icon])),
                style_class: 'popup-menu-icon',
                icon_size: 16
            });
            
            let stationItem = new PopupMenu.PopupMenuItem(station.name);
            stationItem.insert_child_at_index(stationIcon, 1);
            
           
            if (station.id === this._currentStation) {
                stationItem.setOrnament(PopupMenu.Ornament.DOT);
            }
            
            stationItem.connect('activate', () => {
                this._changeStation(station.id);
            });
            
            radioMenu.menu.addMenuItem(stationItem);
        });
        
        this.menu.addMenuItem(radioMenu);
        
       
        let radioToggle = new PopupMenu.PopupSwitchMenuItem(_('Radyo Çal/Durdur'), this._radioPlaying);
        
        let currentStation = this._radioStations[this._currentStationIndex];
        if (currentStation) {
            let toggleIcon = new St.Icon({
                gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', currentStation.icon])),
                style_class: 'popup-menu-icon',
                icon_size: 16
            });
            radioToggle.insert_child_at_index(toggleIcon, 1);
        }
        
        radioToggle.connect('toggled', () => {
            this._toggleRadio();
        });
        this.menu.addMenuItem(radioToggle);
        
        let cityItem = new PopupMenu.PopupSubMenuMenuItem(_("Şehir Seçin"));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

       
        if (this._citiesData && this._citiesData.cities) {
           
            this._citiesData.cities.forEach(countryData => {
                if (countryData.cities && Array.isArray(countryData.cities)) {
                    countryData.cities.forEach(city => {
                        if (city.name) {
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
                        }
                    });
                }
            });
        }
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
        const cityData = this._findCityByName(this._selectedCity);
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
    async _fetchPrayerTimesFromAladhan() {
        this._debug('Aladhan API\'den namaz vakitleri alınıyor (fallback)...');

        const city = this._findCityByName(this._selectedCity);
        if (!city || !city.latitude || !city.longitude) {
            console.error('[Herkul] Şehir koordinatları bulunamadı:', this._selectedCity);
            return false;
        }

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            // method=13 = Turkey Diyanet Affairs hesaplama metodu
            const url = `${ALADHAN_API_BASE}/${timestamp}?latitude=${city.latitude}&longitude=${city.longitude}&method=13`;

            this._debug(`Aladhan URL: ${url}`);

            let message = Soup.Message.new('GET', url);
            let bytes = await this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code === 200) {
                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));

                if (data.code === 200 && data.data && data.data.timings) {
                    const timings = data.data.timings;

                    this._prayerTimes = {
                        'imsak': timings.Imsak,
                        'gunes': timings.Sunrise,
                        'ogle': timings.Dhuhr,
                        'ikindi': timings.Asr,
                        'aksam': timings.Maghrib,
                        'yatsi': timings.Isha
                    };

                    // Hicri takvim bilgisi
                    if (data.data.date && data.data.date.hijri) {
                        const hijri = data.data.date.hijri;
                        this._calendarInfo.hijri = `${hijri.day} ${hijri.month.tr} ${hijri.year}`;
                    }

                    // Miladi takvim bilgisi
                    if (data.data.date && data.data.date.gregorian) {
                        const gregorian = data.data.date.gregorian;
                        this._calendarInfo.gregorian = `${gregorian.day} ${gregorian.month.tr} ${gregorian.year}`;
                    }

                    this._debug('Aladhan API\'den namaz vakitleri başarıyla alındı');
                    this._updateDisplay();
                    this._fetchingIndicator.visible = false;
                    return true;
                }
            }
        } catch (error) {
            console.error('[Herkul] Aladhan API hatası:', error);
        }

        return false;
    }

    _fetchPrayerTimes(retryCount = 0) {
    if (retryCount >= 3) {
        console.error('[Herkul] Diyanet\'ten namaz vakitleri alınamadı, Aladhan API deneniyor...');
        this._fetchPrayerTimesFromAladhan().then(success => {
            if (!success) {
                this._label.text = 'Bağlantı hatası';
                this._fetchingIndicator.visible = false;
            }
        });
        return;
    }

    this._debug(`Namaz vakitleri fetch ediliyor... (deneme: ${retryCount})`);

    const city = this._findCityByName(this._selectedCity);
    if (!city || !city.url) {
        console.error('[Herkul] Şehir URL\'si bulunamadı:', this._selectedCity);
        return;
    }

    this._debug(`URL: ${city.url}`);

    const message = Soup.Message.new('GET', city.url);
    if (!message) {
        console.error('[Herkul] Soup.Message oluşturulamadı');
        return;
    }
    // Daha fazla header ekleyerek gerçek tarayıcıyı daha iyi taklit ediyoruz
    message.request_headers.append('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
    message.request_headers.append('Accept-Language', 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7');
    message.request_headers.append('Accept-Encoding', 'gzip, deflate, br');
    message.request_headers.append('DNT', '1');
    message.request_headers.append('Connection', 'keep-alive');
    message.request_headers.append('Upgrade-Insecure-Requests', '1');
    message.request_headers.append('Sec-Fetch-Dest', 'document');
    message.request_headers.append('Sec-Fetch-Mode', 'navigate');
    message.request_headers.append('Sec-Fetch-Site', 'none');
    message.request_headers.append('Cache-Control', 'max-age=0');
    this._fetchingIndicator.visible = true;
    this._debug('HTTP isteği gönderiliyor...');
    this._httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
        this._debug('HTTP yanıtı alındı');
        try {
            const bytes = session.send_and_read_finish(result);
            this._debug(`Bytes alındı: ${bytes ? bytes.get_size() : 'null'} byte`);

            if (!bytes) throw new Error('Boş yanıt');

            const html = new TextDecoder().decode(bytes.get_data());
            this._debug(`HTML decode edildi: ${html.length} karakter`);

           
            const times = this._parsePrayerTimes(html);

           
            const calendarInfo = this._parseCalendarInfo(html);

           
            this._prayerTimes = times;
            this._calendarInfo = calendarInfo;

           
            if (calendarInfo.hijri) {
                this._debug(`Hicri takvim: ${calendarInfo.hijri}`);
            }
            if (calendarInfo.gregorian) {
                this._debug(`Miladi takvim: ${calendarInfo.gregorian}`);
            }

            this._updateDisplay();
            this._retryCount = 0;
            this._fetchingIndicator.visible = false;

        } catch (error) {
            console.error(`[Herkul] İstek hatası (deneme ${retryCount}):`, error.message);


            const retryTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                if (!this._isDestroyed) {
                    this._fetchPrayerTimes(retryCount + 1);
                }
                return GLib.SOURCE_REMOVE;
            });
            if (retryTimerId) {
                this._activeTimers.add(retryTimerId);
            }
        }
    });
}
_parsePrayerTimes(html) {
    const times = {};

   
    const prayerKeys = ['imsak', 'gunes', 'ogle', 'ikindi', 'aksam', 'yatsi'];

    for (const key of prayerKeys) {
       
        const pattern = new RegExp(
            `<div[^>]*class="tpt-cell"[^>]*data-vakit-name="${key}"[^>]*>[\\s\\S]*?` +
            `<div[^>]*class="tpt-time"[^>]*>([^<]+)<\\/div>`,
            'i'
        );
        const match = html.match(pattern);

        if (match && match[1]) {
            times[key] = match[1].trim();
        }
    }

    if (Object.keys(times).length === 6) {
        this._debug('Namaz vakitleri başarıyla alındı (data-vakit-name method)');
        return times;
    }

   
    const regex = /<div class="tpt-time"[^>]*>([^<]+)<\/div>/gi;
    const matches = html.matchAll(regex);
    const timeValues = Array.from(matches).map(m => m[1].trim());

    if (timeValues.length >= 6) {
        prayerKeys.forEach((key, i) => {
            times[key] = timeValues[i];
        });
        this._debug('Namaz vakitleri başarıyla alındı (sequential method)');
        return times;
    }
  
    const jsVars = {
        imsak: html.match(/var _imsakTime = "([^"]+)";/),
        gunes: html.match(/var _gunesTime = "([^"]+)";/),
        ogle: html.match(/var _ogleTime = "([^"]+)";/),
        ikindi: html.match(/var _ikindiTime = "([^"]+)";/),
        aksam: html.match(/var _aksamTime = "([^"]+)";/),
        yatsi: html.match(/var _yatsiTime = "([^"]+)";/)
    };
    for (const [key, match] of Object.entries(jsVars)) {
        if (match && match[1]) {
            times[key] = match[1];
        }
    }
    if (Object.keys(times).length === 6) {
        console.warn('[Herkul] Namaz vakitleri JS değişkenlerinden alındı (fallback)');
        return times;
    }

    throw new Error('Cevapta namaz vakitleri bulunamadı');
}
_parseCalendarInfo(html) {
    const calendarInfo = {
        hijri: null,
        gregorian: null
    };
   
    const hijriMatch = html.match(/<div[^>]*class="ti-hicri"[^>]*>([^<]+)<\/div>/i);
    if (hijriMatch && hijriMatch[1]) {
        calendarInfo.hijri = hijriMatch[1].trim();
    }
   
    const gregorianMatch = html.match(/<div[^>]*class="ti-miladi"[^>]*>([^<]+)<\/div>/i);
    if (gregorianMatch && gregorianMatch[1]) {
        calendarInfo.gregorian = gregorianMatch[1].trim();
    }

    return calendarInfo;
}

    _updateDisplay() {
        if (this._isDestroyed) return;

        if (this._cityLabel && !this._cityLabel.is_finalized?.()) {
            this._cityLabel.text = this._selectedCity;
        }

        this._checkPrayerTimeEntry();

        const nextPrayer = this._findNextPrayer();
        if (!nextPrayer) return;
        try {
            const timeInfo = this._calculateTimeLeft(nextPrayer.time, nextPrayer.isNextDay);

            if (this._label && !this._label.is_finalized?.()) {
                this._label.text = `${nextPrayer.name}: ${timeInfo.formatted}`;

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

    _checkPrayerTimeEntry() {
        if (!this._ezanEnabled || !this._prayerTimes || Object.keys(this._prayerTimes).length === 0) {
            return;
        }

        let currentTime = GLib.DateTime.new_now_local();
        let currentHour = currentTime.get_hour();
        let currentMinute = currentTime.get_minute();
        let currentTimeString = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

        let prayerNames = getPrayerMap();

        for (let [prayerKey, prayerTime] of Object.entries(this._prayerTimes)) {
            if (prayerTime === currentTimeString) {
                const prayerName = prayerNames[prayerKey];

                if (this._lastEzanPrayer !== prayerTime) {
                    this._debug(`Vakit girdi: ${prayerName} (${prayerTime})`);
                    this._lastEzanPrayer = prayerTime;
                    this._playEzan(prayerName);
                    break;
                }
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
                GLib.source_remove(timerId);
            });
            this._activeTimers.clear();
        }
    }
    _cleanupUI() {
        ['_label', '_icon', '_fetchingIndicator', '_weatherIcon', '_tempLabel', '_cityLabel'].forEach(widgetName => {
            if (this[widgetName] && !this[widgetName].is_finalized?.()) {
                this[widgetName].destroy();
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
        let totalMinutes = diff.totalMinutes;
        
        return {
            hours: diff.hours,
            minutes: diff.minutes,
            seconds: diff.seconds,
            totalMinutes: totalMinutes,
            totalSeconds: diff.totalSeconds,
           
           
            formatted: `${diff.hours}sa ${diff.minutes}dk`,
           
            formattedEn: `${diff.hours}h ${diff.minutes}m ${diff.seconds}s`
        };
    }
    _playEzan(prayerName) {
        if (!this._ezanEnabled) return;

        if (this._isPlayingEzan) {
            this._debug('Ezan zaten çalıyor, yeni ezan başlatılmıyor');
            return;
        }

        try {
            this._isPlayingEzan = true;
            const ezanPath = GLib.build_filenamev([this._extension.path, 'sounds', 'ezan.mp3']);
            const ezanFile = Gio.File.new_for_path(ezanPath);

            if (!ezanFile.query_exists(null)) {
                console.error('[Herkul] ezan.mp3 dosyası bulunamadı');
                this._isPlayingEzan = false;
                return;
            }

            this._debug(`Vakit girdi bildirim sesi çalınıyor: ${prayerName}`);

            Gst.init(null);
            this._ezanPlayer = Gst.ElementFactory.make('playbin', 'ezanplayer');

            if (this._ezanPlayer) {
                const uri = ezanFile.get_uri();
                this._ezanPlayer.set_property('uri', uri);
                this._ezanPlayer.set_state(Gst.State.PLAYING);

                const timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 120, () => {
                    if (this._ezanPlayer) {
                        this._ezanPlayer.set_state(Gst.State.NULL);
                        this._ezanPlayer = null;
                    }
                    this._isPlayingEzan = false;
                    this._debug('Ezan sesi tamamlandı');
                    return GLib.SOURCE_REMOVE;
                });
                this._activeTimers.add(timerId);
            }
        } catch (error) {
            console.error(`[Herkul] Ezan çalınırken hata oluştu: ${error}`);
            this._isPlayingEzan = false;
        }
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
                const soundFileName = this._settings.get_string('notification-sound') || 'call.mp3';
                const soundPath = GLib.build_filenamev([this._extension.path, 'sounds', soundFileName]);
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
        if (this._ezanPlayer) {
            this._ezanPlayer.set_state(Gst.State.NULL);
            this._ezanPlayer = null;
        }
        this._cleanupTimers();
        this._clearTimers();
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