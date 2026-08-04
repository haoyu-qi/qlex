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
class TranslationsGl extends Translations with BaseTranslations<AppLocale, Translations> {
  /// You can call this constructor and build your own translation instance of this locale.
  /// Constructing via the enum [AppLocale.build] is preferred.
  TranslationsGl(
      {Map<String, Node>? overrides,
      PluralResolver? cardinalResolver,
      PluralResolver? ordinalResolver,
      TranslationMetadata<AppLocale, Translations>? meta})
      : assert(overrides == null, 'Set "translation_overrides: true" in order to enable this feature.'),
        $meta = meta ??
            TranslationMetadata(
              locale: AppLocale.gl,
              overrides: overrides ?? {},
              cardinalResolver: cardinalResolver,
              ordinalResolver: ordinalResolver,
            ),
        super(cardinalResolver: cardinalResolver, ordinalResolver: ordinalResolver);

  /// Metadata for the translations of <gl>.
  @override
  final TranslationMetadata<AppLocale, Translations> $meta;

  late final TranslationsGl _root = this; // ignore: unused_field

  @override
  TranslationsGl $copyWith({TranslationMetadata<AppLocale, Translations>? meta}) => TranslationsGl(meta: meta ?? this.$meta);

  // Translations
  @override
  String get locale => 'Inglés';
  @override
  String get appName => 'LocalSend';
  @override
  late final _Translations$general$gl general = _Translations$general$gl._(_root);
  @override
  late final _Translations$receiveTab$gl receiveTab = _Translations$receiveTab$gl._(_root);
  @override
  late final _Translations$sendTab$gl sendTab = _Translations$sendTab$gl._(_root);
  @override
  late final _Translations$settingsTab$gl settingsTab = _Translations$settingsTab$gl._(_root);
}

// Path: general
class _Translations$general$gl extends Translations$general$en {
  _Translations$general$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get accept => 'Aceptar';
  @override
  String get accepted => 'Aceptado';
  @override
  String get add => 'Engadir';
  @override
  String get advanced => 'Avanzado';
  @override
  String get cancel => 'Cancelar';
  @override
  String get close => 'Pechar';
  @override
  String get confirm => 'Confirmar';
  @override
  String get continueStr => 'Continuar';
  @override
  String get copy => 'Copiar';
  @override
  String get copiedToClipboard => 'Copiouse no Portapapeis';
  @override
  String get decline => 'Declinar';
  @override
  String get done => 'Feito';
  @override
  String get delete => 'Eliminar';
  @override
  String get edit => 'Editar';
  @override
  String get error => 'Erro';
  @override
  String get example => 'Exemplo';
  @override
  String get files => 'Arquivos';
  @override
  String get finished => 'Rematou';
  @override
  String get hide => 'Ocultar';
  @override
  String get off => 'Apagado';
  @override
  String get offline => 'Sen Conexión';
  @override
  String get on => 'Activado';
  @override
  String get online => 'En Liña';
  @override
  String get open => 'Aberto';
  @override
  String get queue => 'Fila';
  @override
  String get quickSave => 'Gardar Rápido';
  @override
  String get quickSaveFromFavorites => 'Gardar rápido para "Favoritos"';
  @override
  String get renamed => 'Renomeado';
  @override
  String get reset => 'Desfacer os cambios';
  @override
  String get restart => 'Reiniciar';
  @override
  String get settings => 'Configuración';
  @override
  String get skipped => 'Omitido';
  @override
  String get start => 'Comeza';
  @override
  String get stop => 'Parar';
  @override
  String get save => 'Gardar';
  @override
  String get unchanged => 'Sen Cambios';
  @override
  String get unknown => 'Descoñecido';
  @override
  String get noItemInClipboard => 'Non hai elementos no Portapapeis.';
}

// Path: receiveTab
class _Translations$receiveTab$gl extends Translations$receiveTab$en {
  _Translations$receiveTab$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Recibir';
  @override
  late final _Translations$receiveTab$infoBox$gl infoBox = _Translations$receiveTab$infoBox$gl._(_root);
  @override
  late final _Translations$receiveTab$quickSave$gl quickSave = _Translations$receiveTab$quickSave$gl._(_root);
}

// Path: sendTab
class _Translations$sendTab$gl extends Translations$sendTab$en {
  _Translations$sendTab$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Enviar';
  @override
  late final _Translations$sendTab$selection$gl selection = _Translations$sendTab$selection$gl._(_root);
  @override
  late final _Translations$sendTab$picker$gl picker = _Translations$sendTab$picker$gl._(_root);
  @override
  String get shareIntentInfo => 'Tamén podes usar a función "Compartir" do teu dispositivo móbil para seleccionar ficheiros máis facilmente.';
  @override
  String get nearbyDevices => 'Dispositivos Próximos';
  @override
  String get thisDevice => 'Este Dispositivo';
  @override
  String get scan => 'Busca Dispositivos';
  @override
  String get manualSending => 'Envío Manual';
  @override
  String get sendMode => 'Modo de Envío';
  @override
  late final _Translations$sendTab$sendModes$gl sendModes = _Translations$sendTab$sendModes$gl._(_root);
  @override
  String get sendModeHelp => 'Explicación';
  @override
  String get help => 'Asegúrate de que o obxectivo desexado tamén estea na mesma rede wifi.';
  @override
  String get placeItems => 'Coloca elementos para compartir.';
}

// Path: settingsTab
class _Translations$settingsTab$gl extends Translations$settingsTab$en {
  _Translations$settingsTab$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Configuración';
  @override
  late final _Translations$settingsTab$general$gl general = _Translations$settingsTab$general$gl._(_root);
}

// Path: receiveTab.infoBox
class _Translations$receiveTab$infoBox$gl extends Translations$receiveTab$infoBox$en {
  _Translations$receiveTab$infoBox$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get ip => 'IP:';
  @override
  String get port => 'Porto:';
  @override
  String get alias => 'Nome do Dispositivo:';
}

// Path: receiveTab.quickSave
class _Translations$receiveTab$quickSave$gl extends Translations$receiveTab$quickSave$en {
  _Translations$receiveTab$quickSave$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get off => _root.general.off;
  @override
  String get favorites => 'Favoritos';
  @override
  String get on => _root.general.on;
}

// Path: sendTab.selection
class _Translations$sendTab$selection$gl extends Translations$sendTab$selection$en {
  _Translations$sendTab$selection$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Selección';
  @override
  String files({required Object files}) => 'Ficheiros: ${files}';
  @override
  String size({required Object size}) => 'Tamaño: ${size}';
}

// Path: sendTab.picker
class _Translations$sendTab$picker$gl extends Translations$sendTab$picker$en {
  _Translations$sendTab$picker$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get file => 'Arquivo';
  @override
  String get folder => 'Cartafol';
  @override
  String get media => 'Medios';
  @override
  String get text => 'Texto';
  @override
  String get app => 'App';
  @override
  String get clipboard => 'Pegar';
}

// Path: sendTab.sendModes
class _Translations$sendTab$sendModes$gl extends Translations$sendTab$sendModes$en {
  _Translations$sendTab$sendModes$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get single => 'Destinatario Único';
  @override
  String get multiple => 'Múltiples Destinatarios';
  @override
  String get link => 'Comparte via ligazón';
}

// Path: settingsTab.general
class _Translations$settingsTab$general$gl extends Translations$settingsTab$general$en {
  _Translations$settingsTab$general$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get title => 'Xeral';
  @override
  String get brightness => 'Tema';
  @override
  late final _Translations$settingsTab$general$brightnessOptions$gl brightnessOptions =
      _Translations$settingsTab$general$brightnessOptions$gl._(_root);
  @override
  String get color => 'Cor';
  @override
  late final _Translations$settingsTab$general$colorOptions$gl colorOptions = _Translations$settingsTab$general$colorOptions$gl._(_root);
  @override
  String get language => 'Linguaxe';
  @override
  late final _Translations$settingsTab$general$languageOptions$gl languageOptions = _Translations$settingsTab$general$languageOptions$gl._(_root);
  @override
  String get saveWindowPlacement => 'Garda a posición da xanela despois de saír';
  @override
  String get saveWindowPlacementWindows => 'Garda a posición da xanela despois da saída';
  @override
  String get minimizeToTray => 'Minimizar á Bandexa do Sistema/Barra de Menú ao Pechar';
}

// Path: settingsTab.general.brightnessOptions
class _Translations$settingsTab$general$brightnessOptions$gl extends Translations$settingsTab$general$brightnessOptions$en {
  _Translations$settingsTab$general$brightnessOptions$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get system => 'Sistema';
  @override
  String get dark => 'Escuro';
  @override
  String get light => 'Luz';
}

// Path: settingsTab.general.colorOptions
class _Translations$settingsTab$general$colorOptions$gl extends Translations$settingsTab$general$colorOptions$en {
  _Translations$settingsTab$general$colorOptions$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get system => 'Sistema';
  @override
  String get oled => 'OLED';
}

// Path: settingsTab.general.languageOptions
class _Translations$settingsTab$general$languageOptions$gl extends Translations$settingsTab$general$languageOptions$en {
  _Translations$settingsTab$general$languageOptions$gl._(TranslationsGl root)
      : this._root = root,
        super.internal(root);

  final TranslationsGl _root; // ignore: unused_field

  // Translations
  @override
  String get system => 'Sistema';
}
