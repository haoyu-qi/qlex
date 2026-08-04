///
/// Generated file. Do not edit.
///
// coverage:ignore-file
// ignore_for_file: type=lint, unused_import

import 'package:flutter/widgets.dart';
import 'package:intl/intl.dart';
import 'package:slang/generated.dart';
import 'strings.g.dart';

// Path: <root>
class TranslationsAz extends Translations with BaseTranslations<AppLocale, Translations> {
  /// You can call this constructor and build your own translation instance of this locale.
  /// Constructing via the enum [AppLocale.build] is preferred.
  TranslationsAz(
      {Map<String, Node>? overrides,
      PluralResolver? cardinalResolver,
      PluralResolver? ordinalResolver,
      TranslationMetadata<AppLocale, Translations>? meta})
      : assert(overrides == null, 'Set "translation_overrides: true" in order to enable this feature.'),
        $meta = meta ??
            TranslationMetadata(
              locale: AppLocale.az,
              overrides: overrides ?? {},
              cardinalResolver: cardinalResolver,
              ordinalResolver: ordinalResolver,
            ),
        super(cardinalResolver: cardinalResolver, ordinalResolver: ordinalResolver);

  /// Metadata for the translations of <az>.
  @override
  final TranslationMetadata<AppLocale, Translations> $meta;

  late final TranslationsAz _root = this; // ignore: unused_field

  @override
  TranslationsAz $copyWith({TranslationMetadata<AppLocale, Translations>? meta}) => TranslationsAz(meta: meta ?? this.$meta);

  // Translations
  @override
  String get locale => 'Azərbaycanca';
  @override
  String get appName => 'LocalSend';
  @override
  late final _Translations$general$az general = _Translations$general$az._(_root);
  @override
  late final _Translations$receiveTab$az receiveTab = _Translations$receiveTab$az._(_root);
  @override
  late final _Translations$sendTab$az sendTab = _Translations$sendTab$az._(_root);
  @override
  late final _Translations$settingsTab$az settingsTab = _Translations$settingsTab$az._(_root);
}

// Path: general
class _Translations$general$az extends Translations$general$en {
  _Translations$general$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get accept => 'Qəbul et';
  @override
  String get accepted => 'Qəbul edildi';
  @override
  String get add => 'Əlavə et';
  @override
  String get advanced => 'Qabaqcıl';
  @override
  String get cancel => 'Ləğv et';
  @override
  String get close => 'Bağla';
  @override
  String get confirm => 'Təsdiqlə';
  @override
  String get continueStr => 'Davam et';
  @override
  String get copy => 'Köçür';
  @override
  String get copiedToClipboard => 'Buferə Köçürüldü';
  @override
  String get decline => 'İmtina et';
  @override
  String get done => 'Bitdi';
  @override
  String get delete => 'Sil';
  @override
  String get edit => 'Düzəliş et';
  @override
  String get error => 'Xəta';
  @override
  String get example => 'Nümunə';
  @override
  String get files => 'Fayllar';
  @override
  String get finished => 'Bitdi';
  @override
  String get hide => 'Gizlət';
  @override
  String get off => 'Bağlı';
  @override
  String get offline => 'Oflayn';
  @override
  String get on => 'Aktiv';
  @override
  String get online => 'Onlayn';
  @override
  String get open => 'Aç';
  @override
  String get queue => 'Növbə';
  @override
  String get quickSave => 'Cəld Saxla';
  @override
  String get quickSaveFromFavorites => '"Sevimlilər" üçün cəld saxla';
  @override
  String get renamed => 'Təkrar adlandırıldı';
  @override
  String get reset => 'Dəyişiklikləri geri al';
  @override
  String get restart => 'Təkrar başlat';
  @override
  String get settings => 'Tənzimləmələr';
  @override
  String get skipped => 'Ötürüldü';
  @override
  String get start => 'Başlat';
  @override
  String get stop => 'Dayandır';
  @override
  String get save => 'Saxla';
  @override
  String get unchanged => 'Dəyişməmiş';
  @override
  String get unknown => 'Naməlum';
  @override
  String get noItemInClipboard => 'Buferdə element yoxdur.';
}

// Path: receiveTab
class _Translations$receiveTab$az extends Translations$receiveTab$en {
  _Translations$receiveTab$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Qəbul et';
  @override
  late final _Translations$receiveTab$infoBox$az infoBox = _Translations$receiveTab$infoBox$az._(_root);
  @override
  late final _Translations$receiveTab$quickSave$az quickSave = _Translations$receiveTab$quickSave$az._(_root);
}

// Path: sendTab
class _Translations$sendTab$az extends Translations$sendTab$en {
  _Translations$sendTab$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Göndər';
  @override
  late final _Translations$sendTab$selection$az selection = _Translations$sendTab$selection$az._(_root);
  @override
  late final _Translations$sendTab$picker$az picker = _Translations$sendTab$picker$az._(_root);
  @override
  String get shareIntentInfo => 'Faylları daha rahat seçmək üçün mobil cihazınızın "Paylaş" xüsusiyyətin də istifadə edə bilərsiniz.';
  @override
  String get nearbyDevices => 'Yaxınlıqdakı cihazlar';
  @override
  String get thisDevice => 'Bu Cihaz';
  @override
  String get scan => 'Cihazları axtar';
  @override
  String get manualSending => 'Özünüz göndərin';
  @override
  String get sendMode => 'Göndərmə üsulu';
  @override
  late final _Translations$sendTab$sendModes$az sendModes = _Translations$sendTab$sendModes$az._(_root);
  @override
  String get sendModeHelp => 'İzahat';
  @override
  String get help => 'Xahiş olunur, əmin olun ki, istədiyiniz hədəf eyni Wi-Fi şəbəkəsindədir.';
  @override
  String get placeItems => 'Paylaşmaq üçün elementləri yerləşdir.';
}

// Path: settingsTab
class _Translations$settingsTab$az extends Translations$settingsTab$en {
  _Translations$settingsTab$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Tənzimləmələr';
  @override
  late final _Translations$settingsTab$general$az general = _Translations$settingsTab$general$az._(_root);
  @override
  late final _Translations$settingsTab$receive$az receive = _Translations$settingsTab$receive$az._(_root);
}

// Path: receiveTab.infoBox
class _Translations$receiveTab$infoBox$az extends Translations$receiveTab$infoBox$en {
  _Translations$receiveTab$infoBox$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get ip => 'IP:';
  @override
  String get port => 'Port:';
  @override
  String get alias => 'Cihaz adı:';
}

// Path: receiveTab.quickSave
class _Translations$receiveTab$quickSave$az extends Translations$receiveTab$quickSave$en {
  _Translations$receiveTab$quickSave$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get off => _root.general.off;
  @override
  String get favorites => 'Sevimlilər';
  @override
  String get on => _root.general.on;
}

// Path: sendTab.selection
class _Translations$sendTab$selection$az extends Translations$sendTab$selection$en {
  _Translations$sendTab$selection$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Seçilmə';
  @override
  String files({required Object files}) => 'Fayllar: ${files}';
  @override
  String size({required Object size}) => 'Həcm: ${size}';
}

// Path: sendTab.picker
class _Translations$sendTab$picker$az extends Translations$sendTab$picker$en {
  _Translations$sendTab$picker$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get file => 'Fayl';
  @override
  String get folder => 'Qovluq';
  @override
  String get media => 'Media';
  @override
  String get text => 'Mətn';
  @override
  String get app => 'Tətbiq';
  @override
  String get clipboard => 'Yapışdır';
}

// Path: sendTab.sendModes
class _Translations$sendTab$sendModes$az extends Translations$sendTab$sendModes$en {
  _Translations$sendTab$sendModes$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get single => 'Tək qəbul edən';
  @override
  String get multiple => 'Çoxsaylı alıcılar';
  @override
  String get link => 'Bağlantıdan paylaş';
}

// Path: settingsTab.general
class _Translations$settingsTab$general$az extends Translations$settingsTab$general$en {
  _Translations$settingsTab$general$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Ümumi';
  @override
  String get brightness => 'Tema';
  @override
  late final _Translations$settingsTab$general$brightnessOptions$az brightnessOptions =
      _Translations$settingsTab$general$brightnessOptions$az._(_root);
  @override
  String get color => 'Rəng';
  @override
  late final _Translations$settingsTab$general$colorOptions$az colorOptions = _Translations$settingsTab$general$colorOptions$az._(_root);
  @override
  String get language => 'Dil';
  @override
  late final _Translations$settingsTab$general$languageOptions$az languageOptions = _Translations$settingsTab$general$languageOptions$az._(_root);
  @override
  String get saveWindowPlacement => 'Çıxdıqdan sonra pəncərə mövqeyini saxla';
  @override
  String get saveWindowPlacementWindows => 'Çıxış sonrası pəncərə mövqeyin saxla';
  @override
  String get minimizeToTray => 'Bağlayanda Sistem Sahəsi/Menyu Cizgisinə kiçilt';
  @override
  String get launchAtStartup => 'Girişdən sonra birbaşa başlat';
  @override
  String get launchMinimized => 'Birbaşa başlat: Gizli başlat';
  @override
  String get showInContextMenu => 'Məzmun menyusunda LocalSend-i göstər';
  @override
  String get animations => 'Animasiyalar';
}

// Path: settingsTab.receive
class _Translations$settingsTab$receive$az extends Translations$settingsTab$receive$en {
  _Translations$settingsTab$receive$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Qəbul et';
  @override
  String get quickSave => _root.general.quickSave;
  @override
  String get quickSaveFromFavorites => _root.general.quickSaveFromFavorites;
  @override
  String get autoFinish => 'Avtomatik Bitirmə';
}

// Path: settingsTab.general.brightnessOptions
class _Translations$settingsTab$general$brightnessOptions$az extends Translations$settingsTab$general$brightnessOptions$en {
  _Translations$settingsTab$general$brightnessOptions$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get system => 'Sistem';
  @override
  String get dark => 'Qaranlıq';
  @override
  String get light => 'İşıqlı';
}

// Path: settingsTab.general.colorOptions
class _Translations$settingsTab$general$colorOptions$az extends Translations$settingsTab$general$colorOptions$en {
  _Translations$settingsTab$general$colorOptions$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get system => 'Sistem';
  @override
  String get oled => 'OLED';
}

// Path: settingsTab.general.languageOptions
class _Translations$settingsTab$general$languageOptions$az extends Translations$settingsTab$general$languageOptions$en {
  _Translations$settingsTab$general$languageOptions$az._(TranslationsAz root)
      : this._root = root,
        super.internal(root);

  final TranslationsAz _root; // ignore: unused_field

  // Translations
  @override
  String get system => 'Sistem';
}
