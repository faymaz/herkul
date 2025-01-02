import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export default class Prefs extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    constructor(metadata) {
        super();
        this._metadata = metadata;
        this._settings = this._getSettings();
    }

    _getSettings() {
        const schema = 'org.gnome.shell.extensions.herkul';
        
        const schemaDir = GLib.build_filenamev([this._metadata.path, 'schemas']);
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
            throw new Error(`Schema ${schema} could not be found for extension ${this._metadata.uuid}`);
        }
        
        return new Gio.Settings({ settings_schema: schemaObj });
    }

    fillPreferencesWindow(window) {
        // Tercihler sayfası oluştur
        const page = new Adw.PreferencesPage({
            title: 'Namaz Vakitleri Ayarları',
            icon_name: 'preferences-system-time-symbolic',
        });

        // Bildirimler için tercihler grubu
        const notifyGroup = new Adw.PreferencesGroup({
            title: 'Bildirimler',
            description: 'Bildirim ayarlarını yapılandır'
        });

        // Bildirim ayarları ekle
        const notifySwitch = new Adw.ActionRow({
            title: 'Bildirimleri Etkinleştir',
            subtitle: 'Namaz vakitlerinden önce bildirim göster'
        });

        const notifyToggle = new Gtk.Switch({
            active: this._settings.get_boolean('notify-enabled'),
            valign: Gtk.Align.CENTER,
        });

        notifyToggle.connect('notify::active', (widget) => {
            this._settings.set_boolean('notify-enabled', widget.get_active());
        });

        notifySwitch.add_suffix(notifyToggle);
        notifyGroup.add(notifySwitch);

        // Ses ayarları ekle
        const soundSwitch = new Adw.ActionRow({
            title: 'Sesi Etkinleştir',
            subtitle: 'Bildirimlerle birlikte ses çal'
        });

        const soundToggle = new Gtk.Switch({
            active: this._settings.get_boolean('sound-enabled'),
            valign: Gtk.Align.CENTER,
        });

        soundToggle.connect('notify::active', (widget) => {
            this._settings.set_boolean('sound-enabled', widget.get_active());
        });

        soundSwitch.add_suffix(soundToggle);
        notifyGroup.add(soundSwitch);

        page.add(notifyGroup);

        // Şehirler için tercihler grubu
        const citiesGroup = new Adw.PreferencesGroup({
            title: 'Varsayılan Şehir',
            description: 'Namaz vakitleri için varsayılan şehri seçin'
        });

        try {
            const citiesPath = GLib.build_filenamev([this._metadata.path, 'cities.json']);
            const [success, contents] = GLib.file_get_contents(citiesPath);
            
            if (success) {
                const citiesData = JSON.parse(new TextDecoder().decode(contents));
                const cityNames = citiesData.cities.map(city => city.name);

                const defaultCityRow = new Adw.ComboRow({
                    title: 'Varsayılan Şehir',
                    model: new Gtk.StringList({
                        strings: cityNames
                    })
                });

                // Mevcut seçili şehri ayarla
                const currentCity = this._settings.get_string('default-city');
                const cityIndex = cityNames.indexOf(currentCity);
                if (cityIndex !== -1) {
                    defaultCityRow.selected = cityIndex;
                }

                // Şehir değiştiğinde ayarları güncelle
                defaultCityRow.connect('notify::selected', (widget) => {
                    const selectedCity = cityNames[widget.selected];
                    this._settings.set_string('default-city', selectedCity);
                });

                citiesGroup.add(defaultCityRow);
            }
        } catch (error) {
            log(`[PrayerTimes] Şehir listesi yüklenirken hata oluştu: ${error}`);
            const errorLabel = new Gtk.Label({
                label: 'Şehir listesi yüklenirken hata oluştu',
                css_classes: ['error']
            });
            citiesGroup.add(errorLabel);
        }

        page.add(citiesGroup);
        window.add(page);
    }
}