// extension.js
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
const Gettext = imports.gettext;

const prayerMap = {
    'imsak': 'İmsak',
    'gunes': 'Güneş',
    'ogle': 'Öğle',
    'ikindi': 'İkindi',
    'aksam': 'Akşam',
    'yatsi': 'Yatsı'
};

function loadCitiesData(extensionPath) {
    try {
        let citiesPath = GLib.build_filenamev([extensionPath, 'cities.json']);
        let [success, contents] = GLib.file_get_contents(citiesPath);
        let citiesJson = new TextDecoder().decode(contents);
        let data = JSON.parse(citiesJson);
        return data;
    } catch (error) {
        log(`[PrayerTimes] Error loading cities: ${error}`);
        return null;
    }
}

function calculateTimeDifference(currentTime, targetTime, isNextDay = false) {
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
}

const initTranslations = (extension) => {
    let localeDir = extension.dir.get_child('locale');
    if (localeDir.query_exists(null)) {
        Gettext.bindtextdomain('herkul', localeDir.get_path());
        Gettext.textdomain('herkul');
    }
};

const _ = Gettext.gettext;

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
        this._selectedCity = this._settings.get_string('default-city') || this._citiesData?.cities[0]?.name || "İstanbul";
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
            log(`[PrayerTimes] Error loading icon: ${error}`);
            this._icon = new St.Icon({
                icon_name: 'preferences-system-time-symbolic',
                style_class: 'system-status-icon'
            });
        }
    
        this._label = new St.Label({
            text: 'Yükleniyor...',
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
    
        try {
            let hbox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
            hbox.add_child(this._icon);
            hbox.add_child(this._label);
            hbox.add_child(this._fetchingIndicator);
            this.add_child(hbox);
        } catch (error) {
            log(`[PrayerTimes] Error creating panel layout: ${error}`);
        }
    
        this._buildMenu();
        this._startUpdating();
    }

    _onSettingsChanged(settings, key) {
        switch(key) {
            case 'default-city':
                this._selectedCity = this._settings.get_string('default-city');
                this._fetchPrayerTimes();
                this._rebuildMenu();
                break;
            case 'notify-enabled':
                this._notificationsEnabled = this._settings.get_boolean('notify-enabled');
                break;
            case 'sound-enabled':
                this._soundEnabled = this._settings.get_boolean('sound-enabled');
                break;
        }
    }
    
    _toggleRadio() {
        if (this._radioPlaying) {
            if (this._radioPlayer) {
                this._radioPlayer.set_state(imports.gi.Gst.State.NULL);
                this._radioPlayer = null;
            }
            this._radioPlaying = false;
        } else {
            try {
                imports.gi.Gst.init(null);
                this._radioPlayer = imports.gi.Gst.ElementFactory.make('playbin', 'radio');
                if (this._radioPlayer) {
                    this._radioPlayer.set_property('uri', 'https://s1.wohooo.net/proxy/herkulfo/stream');
                    this._radioPlayer.set_state(imports.gi.Gst.State.PLAYING);
                    this._radioPlaying = true;
                }
            } catch (error) {
                log(`[PrayerTimes] Radio error: ${error}`);
            }
        }
    }

    _clearTimers() {
        for (let timerId of this._activeTimers) {
            GLib.source_remove(timerId);
        }
        this._activeTimers.clear();
    }

    _initHttpSession() {
        try {
            this._httpSession = new Soup.Session({
                timeout: 60,
                user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
            });
            this._retryCount = 0;
        } catch (error) {
            log(`[PrayerTimes] Error initializing HTTP session: ${error}`);
            if (this._retryCount < this._maxRetries) {
                this._retryCount++;
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                    this._initHttpSession();
                    return GLib.SOURCE_REMOVE;
                });
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
                log(`[PrayerTimes] Error showing loading indicator: ${error}`);
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
                log(`[PrayerTimes] Error hiding loading indicator: ${error}`);
            }
        }
    }

    _rebuildMenu() {
        this._buildMenu();
    }

    _buildMenu() {
        this.menu.removeAll();
        if (!this._citiesData) {
            log('[PrayerTimes] No cities data available');
            return;
        }
    
        if (this._prayerTimes && Object.keys(this._prayerTimes).length > 0) {
            Object.entries(this._prayerTimes).forEach(([name, time]) => {
                let prayerName = prayerMap[name];
                let menuItem = new PopupMenu.PopupMenuItem(`${prayerName}: ${time}`);
                this.menu.addMenuItem(menuItem);
            });
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
    
        let radioBox = new St.BoxLayout({ style_class: 'popup-menu-item' });
        
        let radioIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this._extension.path, 'icons', 'herkul.png'])),
            style_class: 'popup-menu-icon',
            icon_size: 16
        });
        
        let radioItem = new PopupMenu.PopupSwitchMenuItem('Herkul Radyo', this._radioPlaying);
        
        radioItem.insert_child_at_index(radioIcon, 1);
        
        radioItem.connect('toggled', () => {
            this._toggleRadio();
        });
        this.menu.addMenuItem(radioItem);
        
        let cityItem = new PopupMenu.PopupSubMenuMenuItem("Şehir Seç");
        
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

        const settingsButton = new PopupMenu.PopupMenuItem('Ayarlar');
        settingsButton.connect('activate', () => {
            if (this._extension) {
                this._extension.openPreferences();
            }
        });
        this.menu.addMenuItem(settingsButton);
    }

    async _fetchPrayerTimes() {
        if (!this._citiesData) {
            log('[PrayerTimes] No cities data available');
            return;
        }
    
        let cityData = this._citiesData.cities.find(city => city.name === this._selectedCity);
        if (!cityData) {
            log(`[PrayerTimes] City not found: ${this._selectedCity}`);
            return;
        }
        
        this._showLoading();
        
        try {
            if (!this._httpSession) {
                log('[PrayerTimes] HTTP session not initialized, retrying...');
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
            log(`[PrayerTimes] Error fetching prayer times: ${error}`);
            this._hideLoading();
            if (error.message.includes('not initialized') || error.message.includes('Xwayland')) {
                if (this._retryCount < this._maxRetries) {
                    this._retryCount++;
                    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                        this._fetchPrayerTimes();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
            this._label.text = 'Vakitler alınamadı';
        }
    }

    _updateDisplay() {
        if (this._isDestroyed) return;
        
        const nextPrayer = this._findNextPrayer();
        if (!nextPrayer) return;
    
        try {
            const timeInfo = this._calculateTimeLeft(nextPrayer.time, nextPrayer.isNextDay);
            const prayerName = _(nextPrayer.name);
            
            if (this._label && !this._label.is_finalized?.()) {
                this._label.text = `${prayerName}: ${timeInfo.formatted}`;
                
                if (timeInfo.totalMinutes >= 15 && timeInfo.totalMinutes <= 20) {
                    this._showNotification(prayerName, timeInfo.totalMinutes);
                }
            }
        } catch (error) {
            log(`[PrayerTimes] Display update error: ${error}`);
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
                    log(`[PrayerTimes] Error removing timer ${timerId}: ${error}`);
                }
            });
            this._activeTimers.clear();
        }
    }

    _cleanupUI() {
        ['_label', '_icon', '_fetchingIndicator'].forEach(widgetName => {
            if (this[widgetName]) {
                try {
                    if (!this[widgetName].is_finalized?.()) {
                        this[widgetName].destroy();
                    }
                } catch (error) {
                    log(`[PrayerTimes] Error destroying ${widgetName}: ${error}`);
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
        
        for (let [name, time] of prayers) {
            if (time > currentTimeString) {
                return {name: prayerMap[name], time, isNextDay: false};
            }
        }
    
        let firstPrayer = prayers[0];
        return {
            name: prayerMap[firstPrayer[0]],
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
            formatted: `${diff.hours}s ${diff.minutes}d`
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
            
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                if (this._icon) {
                    this._icon.style_class = 'system-status-icon';
                    this._isBlinking = false;
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        if (this._soundEnabled && !this._isPlayingSound) {
            try {
                this._isPlayingSound = true;
                const soundPath = GLib.build_filenamev([this._extension.path, 'sounds', 'call.mp3']);
                const soundFile = Gio.File.new_for_path(soundPath);
                
                if (soundFile.query_exists(null)) {
                    imports.gi.Gst.init(null);
                    this._player = imports.gi.Gst.ElementFactory.make('playbin', 'player');
                    
                    if (this._player) {
                        const uri = soundFile.get_uri();
                        this._player.set_property('uri', uri);
                        this._player.set_state(imports.gi.Gst.State.PLAYING);
                        
                        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
                            if (this._player) {
                                this._player.set_state(imports.gi.Gst.State.NULL);
                                this._player = null;
                            }
                            this._isPlayingSound = false;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            } catch (error) {
                log(`[PrayerTimes] Error playing sound: ${error}`);
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
            log(`[PrayerTimes] Error adding timer: ${error}`);
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
            this._addTimer(() => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            }, 60);
        } catch (error) {
            log(`[PrayerTimes] Error starting updates: ${error}`);
        }
    }

    destroy() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        
        this._isDestroyed = true;
        
        try {
            this._cleanupTimers();
            
            if (this._httpSession) {
                try {
                    this._httpSession.abort();
                } catch (error) {
                    log(`[PrayerTimes] Error aborting HTTP session: ${error}`);
                }
                this._httpSession = null;
            }
            
            if (this._radioPlayer) {
                this._radioPlayer.set_state(imports.gi.Gst.State.NULL);
                this._radioPlayer = null;
            }

            this._cleanupUI();

            this._prayerTimes = {};
            this._isPlayingSound = false;
            this._isBlinking = false;
            this._timeoutSource = null;
        } catch (error) {
            log(`[PrayerTimes] Error during cleanup: ${error}`);
        } finally {
            super.destroy();
        }
    }
});

export default class PrayerTimesExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    getSettings() {
        const schema = 'org.gnome.shell.extensions.herkul';
        
        const schemaDir = GLib.build_filenamev([this.path, 'schemas']);
        let schemaSource;
        
        try {
            schemaSource = Gio.SettingsSchemaSource.new_from_directory(
                schemaDir,
                Gio.SettingsSchemaSource.get_default(),
                false
            );
        } catch (err) {
            log(`Failed to load schema from directory: ${err}`);
            throw err;
        }
        
        const schemaObj = schemaSource.lookup(schema, true);
        if (!schemaObj) {
            throw new Error(`Schema ${schema} could not be found for extension ${this.uuid}`);
        }
        
        return new Gio.Settings({ settings_schema: schemaObj });
    }

    enable() {
        log('[PrayerTimes] Enabling extension');
        this._indicator = new PrayerTimesIndicator(this);
        Main.panel.addToStatusArea('prayer-times', this._indicator);
    }

    disable() {
        log('[PrayerTimes] Disabling extension');
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}