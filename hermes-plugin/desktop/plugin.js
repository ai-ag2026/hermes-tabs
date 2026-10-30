// Hermes in the browser - settings page (Settings -> Plugins -> Hermes in the browser).
// The values belong to the browser extension; the backend (dashboard/plugin_api.py) passes them through the relay.
import {
  atom, Button, Input, ListRow, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleRow, useI18n, usePluginI18n,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const muted = 'text-(--ui-text-tertiary)'

// Messages per Hermes locale id (display.language). English is the fallback for anything missing.
// Strings with a placeholder are functions with positional arguments: t('inUse', name).
// Everything except en and de is machine-translated - corrections welcome.
const ID = 'hermes-tabs'
const STR = {
  en: {
    name: 'Hermes in the browser',
    remove: 'Remove',
    unreachable: e => `Browser not reachable: ${e}. Is the browser open with the extension?`,
    loading: 'Loading …',
    untilRestart: 'until the browser restarts',
    untilTime: t => `until ${t}`,
    enable: 'Enable Hermes in the browser',
    enableDesc: 'Hermes operates tabs in your browser through the hermes-tabs extension. Off: Hermes cannot do anything there.',
    permissions: 'Website permissions',
    permissionsDesc: 'These apply to the extension. Reading is always free on allowed sites, clicking and typing need approval.',
    defaultAll: 'Default for all websites',
    defaultAllOn: 'Hermes acts everywhere except on blocked sites.',
    defaultAllAsk: 'Hermes asks before the first click on a website (in the tab and via notification).',
    optAll: 'Allow all websites',
    optAsk: 'Ask for each website',
    tempAll: 'Temporarily allow all websites',
    tempActive: u => `Active ${u}.`,
    tempOff: 'Off.',
    h1: '1 hr', h8: '8 hrs', session: 'Until restart', stop: 'Stop',
    allowedSites: 'Allowed sites',
    always: 'always',
    untilRestartShort: 'until restart',
    allowedEmpty: 'None yet. Approval is given in the tab (“Site: always” / “Site: until restart”).',
    blockedSites: 'Blocked sites',
    blockedDesc: 'Hermes cannot be used on these websites (subdomains included) - not even for reading.',
    guardOther: 'Also block for Hermes’ other web tools',
    guardOtherDesc: 'Off (default): the list only applies to the extension. On: Hermes’ own browser and web extraction also refuse these sites (best effort: URLs assembled in browser code are not detected).',
    add: '+ Add website',
    blockedEmpty: 'No websites added yet.',
    browser: 'Browser',
    inUse: n => `Hermes works in “${n}”. The settings below belong to the browser chosen here.`,
    noneInUse: 'No browser is chosen for Hermes right now (or the chosen one is not connected).',
    hermesHere: 'Hermes works here',
    useTitle: n => `Use “${n}” for Hermes`,
    useDesc: 'Hermes’ browser calls then go to this browser.',
    use: 'Use',
    waiting: n => `Please confirm in the browser${n ? ` “${n}”` : ''} … (waiting up to 120 s)`,
    confirmed: 'Confirmed in the browser - applied.',
    rejected: m => `Not changed: declined or no answer in time.${m ? ` (${m})` : ''}`,
    declined: 'Not changed: declined in the browser.',
    expired: 'Not changed: no answer in the browser within 120 s.',
    confirmHint: 'Loosening must be confirmed in the browser.',
    safety: 'Safety',
    safetyDesc: 'What Hermes may do in this browser. Tightening applies at once; loosening must be confirmed in the browser, so Hermes cannot lift its own limits.',
    safetyOld: 'The extension of this browser does not support safety settings yet. Update the extension (version 0.9.0 or later).',
    pwWarn: 'Hermes can enter passwords. It can type credentials it knows into password fields. Keep this on only as long as you need it.',
    tier: 'Level',
    tier_read: 'Read only',
    tier_standard: 'Standard',
    tier_extended: 'Extended',
    tier_full: 'Full access',
    tier_custom: 'Custom',
    tierD_read: 'Hermes reads, takes screenshots and sees console and network. No clicking, typing, scripts or opening pages.',
    tierD_standard: 'Default: Hermes reads, clicks, types and opens tabs (with approval per website). Scripts cannot write on unapproved sites; password fields and foreign iframes are off limits.',
    tierD_extended: 'Like Standard, plus: scripts may write on unapproved sites and open pop-ups, typing into iframes of other websites, closing tabs you shared yourself.',
    tierD_full: 'Everything allowed, including entering passwords, and no approval prompt per website. Only for tasks you trust.',
    tierD_custom: 'Individual switches differ from every level.',
    abilities: 'Abilities',
    relaxed: 'Relax protections',
    relaxedDesc: 'Off = protected (default). On = the protection is lifted.',
    sw_act: 'Click, type and confirm dialogs',
    sw_js: 'Run JavaScript',
    sw_navigate: 'Open tabs and load pages',
    sw_upload: 'Upload files',
    sw_download: 'Save GIFs to the browser’s download folder',
    sw_devtools: 'Read console and network',
    rx_scriptWrites: 'Scripts may write anywhere',
    rxD_scriptWrites: 'JavaScript may send changing requests and open pop-ups on websites you have not approved.',
    rx_frameTyping: 'Type into foreign iframes',
    rxD_frameTyping: 'Typing into iframes of other websites (sign-in and payment widgets).',
    rx_passwords: 'Enter passwords',
    rxD_passwords: 'Hermes may type into password fields.',
    rx_closeShared: 'Close shared tabs',
    rxD_closeShared: 'Hermes may also close tabs you shared yourself, not only its own.'
  },
  de: {
    name: 'Hermes im Browser',
    remove: 'Entfernen',
    unreachable: e => `Browser nicht erreichbar: ${e}. Ist der Browser mit der Extension offen?`,
    loading: 'Lade …',
    untilRestart: 'bis zum Browser-Neustart',
    untilTime: t => `bis ${t} Uhr`,
    enable: 'Hermes im Browser aktivieren',
    enableDesc: 'Hermes bedient Tabs in deinem Browser über die Hermes-Tabs-Extension. Aus: Hermes kann dort gar nichts tun.',
    permissions: 'Website-Berechtigungen',
    permissionsDesc: 'Gelten für die Extension. Lesen ist auf erlaubten Seiten immer frei, Klicken und Tippen braucht die Freigabe.',
    defaultAll: 'Standard für alle Websites',
    defaultAllOn: 'Hermes handelt überall, außer auf blockierten Seiten.',
    defaultAllAsk: 'Hermes fragt vor dem ersten Klick auf einer Website (im Tab und per Benachrichtigung).',
    optAll: 'Alle Websites erlauben',
    optAsk: 'Bei jeder Website fragen',
    tempAll: 'Vorübergehend alle Websites erlauben',
    tempActive: u => `Aktiv ${u}.`,
    tempOff: 'Aus.',
    h1: '1 Std.', h8: '8 Std.', session: 'Bis Neustart', stop: 'Beenden',
    allowedSites: 'Erlaubte Seiten',
    always: 'immer',
    untilRestartShort: 'bis Neustart',
    allowedEmpty: 'Noch keine. Erlaubt wird im Tab („Website: immer“ / „bis Neustart“).',
    blockedSites: 'Blockierte Seiten',
    blockedDesc: 'Hermes kann auf diesen Websites nicht verwendet werden (Subdomains eingeschlossen) – auch nicht lesen.',
    guardOther: 'Auch für Hermes’ andere Web-Werkzeuge sperren',
    guardOtherDesc: 'Aus (Vorgabe): Die Liste gilt nur für die Extension. An: Auch Hermes’ eigener Browser und das Auslesen von Webseiten lehnen diese Seiten ab (nach bestem Bemühen: im Browser-Code zusammengesetzte Adressen werden nicht erkannt).',
    add: '+ Website hinzufügen',
    blockedEmpty: 'Noch keine Websites hinzugefügt.',
    browser: 'Browser',
    inUse: n => `Hermes arbeitet in „${n}“. Die Einstellungen unten gehören zum hier gewählten Browser.`,
    noneInUse: 'Für Hermes ist gerade kein Browser gewählt (oder der gewählte ist nicht verbunden).',
    hermesHere: 'Hermes arbeitet hier',
    useTitle: n => `„${n}“ für Hermes verwenden`,
    useDesc: 'Hermes’ Browser-Aufrufe gehen dann an diesen Browser.',
    use: 'Verwenden',
    waiting: n => `Bitte im Browser${n ? ` „${n}“` : ''} bestätigen … (wartet bis zu 120 s)`,
    confirmed: 'Im Browser bestätigt – übernommen.',
    rejected: m => `Nicht geändert: abgelehnt oder keine Antwort rechtzeitig.${m ? ` (${m})` : ''}`,
    declined: 'Nicht geändert: im Browser abgelehnt.',
    expired: 'Nicht geändert: keine Antwort im Browser innerhalb von 120 s.',
    confirmHint: 'Lockern muss im Browser bestätigt werden.',
    safety: 'Sicherheit',
    safetyDesc: 'Was Hermes in diesem Browser darf. Verschärfen gilt sofort; Lockern muss im Browser bestätigt werden, damit Hermes seine Grenzen nicht selbst aufheben kann.',
    safetyOld: 'Die Extension dieses Browsers kennt noch keine Sicherheitsstufen. Extension aktualisieren (ab Version 0.9.0).',
    pwWarn: 'Hermes kann Passwörter eingeben. Er kann Zugangsdaten, die er kennt, in Passwortfelder tippen. Nur so lange anlassen, wie du es brauchst.',
    tier: 'Stufe',
    tier_read: 'Nur lesen',
    tier_standard: 'Standard',
    tier_extended: 'Erweitert',
    tier_full: 'Vollzugriff',
    tier_custom: 'Eigene Einstellung',
    tierD_read: 'Hermes liest, macht Screenshots und sieht Konsole und Netzwerk. Kein Klicken, Tippen, keine Skripte, kein Öffnen von Seiten.',
    tierD_standard: 'Vorgabe: Hermes liest, klickt, tippt und öffnet Tabs (mit Freigabe je Website). Skripte schreiben auf nicht freigegebenen Seiten nicht; Passwortfelder und fremde iframes sind gesperrt.',
    tierD_extended: 'Wie Standard, zusätzlich: Skripte dürfen auf nicht freigegebenen Seiten schreiben und Pop-ups öffnen, Tippen in iframes fremder Websites, auch von dir freigegebene Tabs schließen.',
    tierD_full: 'Alles erlaubt, auch Passwörter eingeben, und keine Rückfrage je Website. Nur für Aufgaben, denen du vertraust.',
    tierD_custom: 'Einzelne Schalter weichen von jeder Stufe ab.',
    abilities: 'Fähigkeiten',
    relaxed: 'Schutz lockern',
    relaxedDesc: 'Aus = geschützt (Vorgabe). An = der Schutz ist aufgehoben.',
    sw_act: 'Klicken, Tippen und Dialoge bestätigen',
    sw_js: 'JavaScript ausführen',
    sw_navigate: 'Tabs öffnen und Seiten laden',
    sw_upload: 'Dateien hochladen',
    sw_download: 'GIFs in den Download-Ordner des Browsers speichern',
    sw_devtools: 'Konsole und Netzwerk mitlesen',
    rx_scriptWrites: 'Skripte dürfen überall schreiben',
    rxD_scriptWrites: 'JavaScript darf auf nicht freigegebenen Seiten ändernde Anfragen senden und Pop-ups öffnen.',
    rx_frameTyping: 'In fremde iframes tippen',
    rxD_frameTyping: 'Tippen in iframes anderer Websites (Anmelde- und Zahlungs-Widgets).',
    rx_passwords: 'Passwörter eingeben',
    rxD_passwords: 'Hermes darf in Passwortfelder tippen.',
    rx_closeShared: 'Freigegebene Tabs schließen',
    rxD_closeShared: 'Hermes darf auch Tabs schließen, die du selbst freigegeben hast, nicht nur seine eigenen.'
  },
  fr: {
    name: 'Hermes dans le navigateur',
    remove: 'Supprimer',
    unreachable: e => `Navigateur injoignable : ${e}. Le navigateur est-il ouvert avec l’extension ?`,
    loading: 'Chargement…',
    untilRestart: 'jusqu’au redémarrage du navigateur',
    untilTime: t => `jusqu’à ${t}`,
    enable: 'Activer Hermes dans le navigateur',
    enableDesc: 'Hermes pilote les onglets de votre navigateur via l’extension hermes-tabs. Désactivé : Hermes ne peut rien y faire.',
    permissions: 'Autorisations des sites web',
    permissionsDesc: 'S’appliquent à l’extension. La lecture est toujours libre sur les sites autorisés ; cliquer et saisir demandent une approbation.',
    defaultAll: 'Par défaut pour tous les sites web',
    defaultAllOn: 'Hermes agit partout, sauf sur les sites bloqués.',
    defaultAllAsk: 'Hermes demande avant le premier clic sur un site web (dans l’onglet et par notification).',
    optAll: 'Autoriser tous les sites web',
    optAsk: 'Demander pour chaque site web',
    tempAll: 'Autoriser temporairement tous les sites web',
    tempActive: u => `Actif ${u}.`,
    tempOff: 'Désactivé.',
    h1: '1 h', h8: '8 h', session: 'Jusqu’au redémarrage', stop: 'Arrêter',
    allowedSites: 'Sites autorisés',
    always: 'toujours',
    untilRestartShort: 'jusqu’au redémarrage',
    allowedEmpty: 'Aucun pour l’instant. L’approbation se donne dans l’onglet (« Site : toujours » / « Site : jusqu’au redémarrage »).',
    blockedSites: 'Sites bloqués',
    blockedDesc: 'Hermes ne peut pas être utilisé sur ces sites web (sous-domaines inclus), pas même pour lire.',
    guardOther: 'Bloquer aussi pour les autres outils web de Hermes',
    guardOtherDesc: 'Désactivé (par défaut) : la liste ne vaut que pour l’extension. Activé : le navigateur propre à Hermes et l’extraction de pages web refusent aussi ces sites (au mieux : les adresses assemblées dans du code de navigateur ne sont pas détectées).',
    add: '+ Ajouter un site web',
    blockedEmpty: 'Aucun site web ajouté pour l’instant.',
    browser: 'Navigateur',
    inUse: n => `Hermes travaille dans « ${n} ». Les réglages ci-dessous concernent le navigateur choisi ici.`,
    noneInUse: 'Aucun navigateur n’est choisi pour Hermes actuellement (ou le navigateur choisi n’est pas connecté).',
    hermesHere: 'Hermes travaille ici',
    useTitle: n => `Utiliser « ${n} » pour Hermes`,
    useDesc: 'Les appels de navigateur de Hermes iront alors vers ce navigateur.',
    use: 'Utiliser',
    waiting: n => `Veuillez confirmer dans le navigateur${n ? ` « ${n} »` : ''} … (attente jusqu’à 120 s)`,
    confirmed: 'Confirmé dans le navigateur – appliqué.',
    rejected: m => `Non modifié : refusé ou pas de réponse à temps.${m ? ` (${m})` : ''}`,
    declined: 'Non modifié : refusé dans le navigateur.',
    expired: 'Non modifié : pas de réponse dans le navigateur en 120 s.',
    confirmHint: 'Un assouplissement doit être confirmé dans le navigateur.',
    safety: 'Sécurité',
    safetyDesc: 'Ce que Hermes peut faire dans ce navigateur. Un durcissement s’applique tout de suite ; un assouplissement doit être confirmé dans le navigateur, afin que Hermes ne puisse pas lever lui-même ses limites.',
    safetyOld: 'L’extension de ce navigateur ne gère pas encore les réglages de sécurité. Mettez-la à jour (version 0.9.0 ou ultérieure).',
    pwWarn: 'Hermes peut saisir des mots de passe. Il peut taper dans les champs de mot de passe les identifiants qu’il connaît. Ne gardez cela activé que le temps nécessaire.',
    tier: 'Niveau',
    tier_read: 'Lecture seule',
    tier_standard: 'Standard',
    tier_extended: 'Étendu',
    tier_full: 'Accès complet',
    tier_custom: 'Personnalisé',
    tierD_read: 'Hermes lit, fait des captures d’écran et voit la console et le réseau. Ni clic, ni saisie, ni script, ni ouverture de pages.',
    tierD_standard: 'Par défaut : Hermes lit, clique, saisit et ouvre des onglets (avec autorisation par site). Les scripts n’écrivent pas sur les sites non autorisés ; champs de mot de passe et iframes tierces interdits.',
    tierD_extended: 'Comme Standard, plus : les scripts peuvent écrire sur les sites non autorisés et ouvrir des pop-ups, saisie dans les iframes d’autres sites, fermeture aussi des onglets que vous avez partagés.',
    tierD_full: 'Tout est permis, y compris saisir des mots de passe, et aucune demande par site. Uniquement pour des tâches de confiance.',
    tierD_custom: 'Certains interrupteurs diffèrent de tous les niveaux.',
    abilities: 'Capacités',
    relaxed: 'Assouplir la protection',
    relaxedDesc: 'Désactivé = protégé (par défaut). Activé = la protection est levée.',
    sw_act: 'Cliquer, saisir et confirmer les boîtes de dialogue',
    sw_js: 'Exécuter du JavaScript',
    sw_navigate: 'Ouvrir des onglets et charger des pages',
    sw_upload: 'Téléverser des fichiers',
    sw_download: 'Enregistrer les GIF dans le dossier de téléchargement du navigateur',
    sw_devtools: 'Lire la console et le réseau',
    rx_scriptWrites: 'Scripts autorisés à écrire partout',
    rxD_scriptWrites: 'JavaScript peut envoyer des requêtes modifiantes et ouvrir des pop-ups sur des sites non autorisés.',
    rx_frameTyping: 'Saisir dans des iframes tierces',
    rxD_frameTyping: 'Saisie dans les iframes d’autres sites (widgets de connexion et de paiement).',
    rx_passwords: 'Saisir des mots de passe',
    rxD_passwords: 'Hermes peut saisir dans les champs de mot de passe.',
    rx_closeShared: 'Fermer les onglets partagés',
    rxD_closeShared: 'Hermes peut aussi fermer les onglets que vous avez partagés, pas seulement les siens.'
  },
  es: {
    name: 'Hermes en el navegador',
    remove: 'Quitar',
    unreachable: e => `No se puede acceder al navegador: ${e}. ¿Está abierto el navegador con la extensión?`,
    loading: 'Cargando…',
    untilRestart: 'hasta que se reinicie el navegador',
    untilTime: t => `hasta las ${t}`,
    enable: 'Activar Hermes en el navegador',
    enableDesc: 'Hermes maneja las pestañas de tu navegador mediante la extensión hermes-tabs. Desactivado: Hermes no puede hacer nada allí.',
    permissions: 'Permisos de sitios web',
    permissionsDesc: 'Se aplican a la extensión. Leer es siempre libre en los sitios permitidos; hacer clic y escribir requieren aprobación.',
    defaultAll: 'Valor predeterminado para todos los sitios web',
    defaultAllOn: 'Hermes actúa en todas partes, excepto en los sitios bloqueados.',
    defaultAllAsk: 'Hermes pregunta antes del primer clic en un sitio web (en la pestaña y por notificación).',
    optAll: 'Permitir todos los sitios web',
    optAsk: 'Preguntar por cada sitio web',
    tempAll: 'Permitir temporalmente todos los sitios web',
    tempActive: u => `Activo ${u}.`,
    tempOff: 'Desactivado.',
    h1: '1 h', h8: '8 h', session: 'Hasta reiniciar', stop: 'Detener',
    allowedSites: 'Sitios permitidos',
    always: 'siempre',
    untilRestartShort: 'hasta reiniciar',
    allowedEmpty: 'Ninguno todavía. La aprobación se da en la pestaña («Sitio: siempre» / «Sitio: hasta reiniciar»).',
    blockedSites: 'Sitios bloqueados',
    blockedDesc: 'Hermes no se puede usar en estos sitios web (subdominios incluidos), ni siquiera para leer.',
    guardOther: 'Bloquear también para las demás herramientas web de Hermes',
    guardOtherDesc: 'Desactivado (predeterminado): la lista solo vale para la extensión. Activado: el navegador propio de Hermes y la extracción de páginas web también rechazan estos sitios (en la medida de lo posible: no se detectan direcciones armadas en código del navegador).',
    add: '+ Añadir sitio web',
    blockedEmpty: 'Aún no se ha añadido ningún sitio web.',
    browser: 'Navegador',
    inUse: n => `Hermes trabaja en «${n}». Los ajustes de abajo pertenecen al navegador elegido aquí.`,
    noneInUse: 'Ahora mismo no hay ningún navegador elegido para Hermes (o el elegido no está conectado).',
    hermesHere: 'Hermes trabaja aquí',
    useTitle: n => `Usar «${n}» para Hermes`,
    useDesc: 'Las llamadas de navegador de Hermes irán entonces a este navegador.',
    use: 'Usar',
    waiting: n => `Confirma en el navegador${n ? ` «${n}»` : ''} … (espera hasta 120 s)`,
    confirmed: 'Confirmado en el navegador: aplicado.',
    rejected: m => `Sin cambios: rechazado o sin respuesta a tiempo.${m ? ` (${m})` : ''}`,
    declined: 'Sin cambios: rechazado en el navegador.',
    expired: 'Sin cambios: no hubo respuesta en el navegador en 120 s.',
    confirmHint: 'Relajar una restricción debe confirmarse en el navegador.',
    safety: 'Seguridad',
    safetyDesc: 'Lo que Hermes puede hacer en este navegador. Endurecer se aplica al instante; relajar debe confirmarse en el navegador, para que Hermes no pueda quitarse sus propios límites.',
    safetyOld: 'La extensión de este navegador aún no admite los ajustes de seguridad. Actualiza la extensión (versión 0.9.0 o posterior).',
    pwWarn: 'Hermes puede introducir contraseñas. Puede escribir en los campos de contraseña las credenciales que conoce. Mantén esto activado solo mientras lo necesites.',
    tier: 'Nivel',
    tier_read: 'Solo lectura',
    tier_standard: 'Estándar',
    tier_extended: 'Ampliado',
    tier_full: 'Acceso total',
    tier_custom: 'Personalizado',
    tierD_read: 'Hermes lee, hace capturas y ve la consola y la red. Sin clics, escritura, scripts ni abrir páginas.',
    tierD_standard: 'Predeterminado: Hermes lee, hace clic, escribe y abre pestañas (con aprobación por sitio). Los scripts no escriben en sitios no aprobados; campos de contraseña e iframes ajenos bloqueados.',
    tierD_extended: 'Como Estándar, además: los scripts pueden escribir en sitios no aprobados y abrir ventanas emergentes, escribir en iframes de otros sitios y cerrar también las pestañas que compartiste.',
    tierD_full: 'Todo permitido, también introducir contraseñas, y sin preguntar por sitio. Solo para tareas de confianza.',
    tierD_custom: 'Algunos interruptores difieren de todos los niveles.',
    abilities: 'Capacidades',
    relaxed: 'Relajar protecciones',
    relaxedDesc: 'Desactivado = protegido (predeterminado). Activado = la protección se levanta.',
    sw_act: 'Hacer clic, escribir y confirmar diálogos',
    sw_js: 'Ejecutar JavaScript',
    sw_navigate: 'Abrir pestañas y cargar páginas',
    sw_upload: 'Subir archivos',
    sw_download: 'Guardar GIF en la carpeta de descargas del navegador',
    sw_devtools: 'Leer consola y red',
    rx_scriptWrites: 'Scripts pueden escribir en cualquier sitio',
    rxD_scriptWrites: 'JavaScript puede enviar solicitudes que modifican datos y abrir ventanas emergentes en sitios no aprobados.',
    rx_frameTyping: 'Escribir en iframes ajenos',
    rxD_frameTyping: 'Escribir en iframes de otros sitios web (widgets de inicio de sesión y de pago).',
    rx_passwords: 'Introducir contraseñas',
    rxD_passwords: 'Hermes puede escribir en campos de contraseña.',
    rx_closeShared: 'Cerrar pestañas compartidas',
    rxD_closeShared: 'Hermes también puede cerrar las pestañas que compartiste tú, no solo las suyas.'
  },
  ru: {
    name: 'Hermes в браузере',
    remove: 'Убрать',
    unreachable: e => `Браузер недоступен: ${e}. Открыт ли браузер с расширением?`,
    loading: 'Загрузка…',
    untilRestart: 'до перезапуска браузера',
    untilTime: t => `до ${t}`,
    enable: 'Включить Hermes в браузере',
    enableDesc: 'Hermes управляет вкладками вашего браузера через расширение hermes-tabs. Выкл.: Hermes ничего там не может делать.',
    permissions: 'Разрешения для сайтов',
    permissionsDesc: 'Действуют для расширения. Чтение на разрешённых сайтах всегда свободно, клики и ввод требуют подтверждения.',
    defaultAll: 'По умолчанию для всех сайтов',
    defaultAllOn: 'Hermes действует везде, кроме заблокированных сайтов.',
    defaultAllAsk: 'Hermes спрашивает перед первым кликом на сайте (во вкладке и в уведомлении).',
    optAll: 'Разрешить все сайты',
    optAsk: 'Спрашивать для каждого сайта',
    tempAll: 'Временно разрешить все сайты',
    tempActive: u => `Активно ${u}.`,
    tempOff: 'Выключено.',
    h1: '1 ч', h8: '8 ч', session: 'До перезапуска', stop: 'Остановить',
    allowedSites: 'Разрешённые сайты',
    always: 'всегда',
    untilRestartShort: 'до перезапуска',
    allowedEmpty: 'Пока нет. Разрешение даётся во вкладке («Сайт: всегда» / «до перезапуска»).',
    blockedSites: 'Заблокированные сайты',
    blockedDesc: 'Hermes нельзя использовать на этих сайтах (включая поддомены), даже для чтения.',
    guardOther: 'Блокировать и для других веб-инструментов Hermes',
    guardOtherDesc: 'Выкл. (по умолчанию): список действует только для расширения. Вкл.: собственный браузер Hermes и извлечение веб-страниц тоже отказываются от этих сайтов (по возможности: адреса, собранные в коде браузера, не распознаются).',
    add: '+ Добавить сайт',
    blockedEmpty: 'Сайты пока не добавлены.',
    browser: 'Браузер',
    inUse: n => `Hermes работает в «${n}». Настройки ниже относятся к выбранному здесь браузеру.`,
    noneInUse: 'Сейчас для Hermes не выбран браузер (или выбранный не подключён).',
    hermesHere: 'Hermes работает здесь',
    useTitle: n => `Использовать «${n}» для Hermes`,
    useDesc: 'Вызовы браузера из Hermes будут направляться в этот браузер.',
    use: 'Использовать',
    waiting: n => `Подтвердите в браузере${n ? ` «${n}»` : ''} … (ожидание до 120 с)`,
    confirmed: 'Подтверждено в браузере – применено.',
    rejected: m => `Не изменено: отклонено или нет ответа вовремя.${m ? ` (${m})` : ''}`,
    declined: 'Не изменено: отклонено в браузере.',
    expired: 'Не изменено: нет ответа в браузере в течение 120 с.',
    confirmHint: 'Ослабление нужно подтвердить в браузере.',
    safety: 'Безопасность',
    safetyDesc: 'Что Hermes может делать в этом браузере. Ужесточение действует сразу; ослабление нужно подтвердить в браузере, чтобы Hermes не мог сам снять свои ограничения.',
    safetyOld: 'Расширение этого браузера пока не поддерживает настройки безопасности. Обновите расширение (версия 0.9.0 или новее).',
    pwWarn: 'Hermes может вводить пароли. Он может вводить в поля паролей известные ему учётные данные. Держите это включённым только пока нужно.',
    tier: 'Уровень',
    tier_read: 'Только чтение',
    tier_standard: 'Стандартный',
    tier_extended: 'Расширенный',
    tier_full: 'Полный доступ',
    tier_custom: 'Свои настройки',
    tierD_read: 'Hermes читает, делает снимки экрана и видит консоль и сеть. Без кликов, ввода, скриптов и открытия страниц.',
    tierD_standard: 'По умолчанию: Hermes читает, кликает, вводит текст и открывает вкладки (с разрешением для каждого сайта). Скрипты не пишут на неодобренных сайтах; поля паролей и чужие iframe закрыты.',
    tierD_extended: 'Как «Стандартный», плюс: скрипты могут писать на неодобренных сайтах и открывать всплывающие окна, ввод в iframe других сайтов, закрытие и тех вкладок, которыми вы поделились.',
    tierD_full: 'Разрешено всё, в том числе вводить пароли, и без запроса для каждого сайта. Только для доверенных задач.',
    tierD_custom: 'Отдельные переключатели отличаются от любого уровня.',
    abilities: 'Возможности',
    relaxed: 'Ослабить защиту',
    relaxedDesc: 'Выкл. = защищено (по умолчанию). Вкл. = защита снята.',
    sw_act: 'Кликать, вводить текст и подтверждать диалоги',
    sw_js: 'Выполнять JavaScript',
    sw_navigate: 'Открывать вкладки и загружать страницы',
    sw_upload: 'Загружать файлы',
    sw_download: 'Сохранять GIF в папку загрузок браузера',
    sw_devtools: 'Читать консоль и сеть',
    rx_scriptWrites: 'Скриптам можно писать везде',
    rxD_scriptWrites: 'JavaScript может отправлять изменяющие запросы и открывать всплывающие окна на неодобренных сайтах.',
    rx_frameTyping: 'Вводить в чужие iframe',
    rxD_frameTyping: 'Ввод в iframe других сайтов (виджеты входа и оплаты).',
    rx_passwords: 'Вводить пароли',
    rxD_passwords: 'Hermes может вводить текст в поля паролей.',
    rx_closeShared: 'Закрывать общие вкладки',
    rxD_closeShared: 'Hermes может закрывать и вкладки, которыми поделились вы, а не только свои.'
  },
  ja: {
    name: 'ブラウザー上の Hermes',
    remove: '削除',
    unreachable: e => `ブラウザーに接続できません: ${e}。拡張機能を入れたブラウザーは開いていますか?`,
    loading: '読み込み中…',
    untilRestart: 'ブラウザーを再起動するまで',
    untilTime: t => `${t} まで`,
    enable: 'ブラウザーで Hermes を有効にする',
    enableDesc: 'Hermes は hermes-tabs 拡張機能を通じて、お使いのブラウザーのタブを操作します。オフ: Hermes はブラウザー上では何もできません。',
    permissions: 'ウェブサイトの権限',
    permissionsDesc: '拡張機能に適用されます。許可したサイトでは閲覧は常に自由で、クリックと入力には承認が必要です。',
    defaultAll: 'すべてのウェブサイトの既定',
    defaultAllOn: 'ブロックしたサイトを除き、Hermes はどこでも操作します。',
    defaultAllAsk: 'Hermes はウェブサイトでの最初のクリックの前に確認します（タブ内と通知で）。',
    optAll: 'すべてのウェブサイトを許可',
    optAsk: 'ウェブサイトごとに確認',
    tempAll: 'すべてのウェブサイトを一時的に許可',
    tempActive: u => `有効: ${u}。`,
    tempOff: 'オフ。',
    h1: '1 時間', h8: '8 時間', session: '再起動まで', stop: '停止',
    allowedSites: '許可したサイト',
    always: '常に',
    untilRestartShort: '再起動まで',
    allowedEmpty: 'まだありません。承認はタブ内で行います（「サイト: 常に」/「サイト: 再起動まで」）。',
    blockedSites: 'ブロックしたサイト',
    blockedDesc: 'これらのウェブサイト（サブドメインを含む）では Hermes を使えません。閲覧もできません。',
    guardOther: 'Hermes のほかのウェブツールでもブロックする',
    guardOtherDesc: 'オフ（既定）：リストは拡張機能にのみ適用されます。オン：Hermes 自身のブラウザーとウェブページ抽出もこれらのサイトを拒否します（ベストエフォート：ブラウザーコード内で組み立てられたアドレスは検出されません）。',
    add: '+ ウェブサイトを追加',
    blockedEmpty: 'ウェブサイトはまだ追加されていません。',
    browser: 'ブラウザー',
    inUse: n => `Hermes は「${n}」で動作しています。以下の設定は、ここで選んだブラウザーのものです。`,
    noneInUse: '現在、Hermes 用のブラウザーが選ばれていません（または選ばれたブラウザーが接続されていません）。',
    hermesHere: 'Hermes はここで動作中',
    useTitle: n => `Hermes に「${n}」を使う`,
    useDesc: '以降、Hermes のブラウザー呼び出しはこのブラウザーに送られます。',
    use: '使用',
    waiting: n => `ブラウザー${n ? `「${n}」` : ''}で確認してください …（最大 120 秒待機）`,
    confirmed: 'ブラウザーで確認され、反映されました。',
    rejected: m => `変更されませんでした: 拒否されたか、時間内に応答がありませんでした。${m ? `（${m}）` : ''}`,
    declined: '変更されませんでした: ブラウザーで拒否されました。',
    expired: '変更されませんでした: 120 秒以内にブラウザーで応答がありませんでした。',
    confirmHint: '制限の緩和はブラウザーでの確認が必要です。',
    safety: 'セキュリティ',
    safetyDesc: 'このブラウザーで Hermes にできること。厳しくする変更はすぐに反映され、緩める変更はブラウザーでの確認が必要です。Hermes が自分で制限を外せないようにするためです。',
    safetyOld: 'このブラウザーの拡張機能はまだセキュリティ設定に対応していません。拡張機能を更新してください（バージョン 0.9.0 以降）。',
    pwWarn: 'Hermes はパスワードを入力できます。知っている認証情報をパスワード欄に入力できてしまいます。必要な間だけオンにしてください。',
    tier: 'レベル',
    tier_read: '閲覧のみ',
    tier_standard: '標準',
    tier_extended: '拡張',
    tier_full: 'フルアクセス',
    tier_custom: 'カスタム',
    tierD_read: 'Hermes は閲覧、スクリーンショット、コンソールとネットワークの確認ができます。クリック、入力、スクリプト、ページを開くことはできません。',
    tierD_standard: '既定: Hermes は閲覧、クリック、入力、タブを開くことができます（ウェブサイトごとの承認あり）。未承認サイトではスクリプトは書き込めず、パスワード欄と他サイトの iframe は使えません。',
    tierD_extended: '標準に加えて: 未承認サイトでスクリプトが書き込みやポップアップを開けること、他サイトの iframe への入力、あなたが共有したタブも閉じられること。',
    tierD_full: 'すべて許可。パスワードの入力も含み、ウェブサイトごとの確認もありません。信頼できる作業にのみ使ってください。',
    tierD_custom: '個別のスイッチがどのレベルとも異なります。',
    abilities: '機能',
    relaxed: '保護を緩める',
    relaxedDesc: 'オフ = 保護あり（既定）。オン = 保護を解除。',
    sw_act: 'クリック、入力、ダイアログの確認',
    sw_js: 'JavaScript の実行',
    sw_navigate: 'タブを開く・ページを読み込む',
    sw_upload: 'ファイルのアップロード',
    sw_download: 'GIF をブラウザーのダウンロードフォルダーに保存',
    sw_devtools: 'コンソールとネットワークの閲覧',
    rx_scriptWrites: 'スクリプトがどこでも書き込める',
    rxD_scriptWrites: '未承認のサイトで、JavaScript が変更を伴うリクエストの送信やポップアップを開くことを許可します。',
    rx_frameTyping: '他サイトの iframe に入力',
    rxD_frameTyping: '他のウェブサイトの iframe（ログインや支払いのウィジェット）への入力。',
    rx_passwords: 'パスワードを入力',
    rxD_passwords: 'Hermes がパスワード欄に入力できます。',
    rx_closeShared: '共有タブを閉じる',
    rxD_closeShared: 'Hermes は自分のタブだけでなく、あなたが共有したタブも閉じられます。'
  },
  zh: {
    name: '浏览器中的 Hermes',
    remove: '移除',
    unreachable: e => `无法连接浏览器：${e}。浏览器是否已打开并装有扩展？`,
    loading: '加载中…',
    untilRestart: '直到浏览器重启',
    untilTime: t => `直到 ${t}`,
    enable: '启用浏览器中的 Hermes',
    enableDesc: 'Hermes 通过 hermes-tabs 扩展操作你浏览器中的标签页。关闭后：Hermes 在浏览器中什么也做不了。',
    permissions: '网站权限',
    permissionsDesc: '适用于扩展。在已允许的网站上，读取始终不受限制，点击和输入需要批准。',
    defaultAll: '所有网站的默认设置',
    defaultAllOn: 'Hermes 在除被阻止网站以外的所有地方操作。',
    defaultAllAsk: 'Hermes 会在首次点击某个网站之前询问（在标签页内并通过通知）。',
    optAll: '允许所有网站',
    optAsk: '逐个网站询问',
    tempAll: '临时允许所有网站',
    tempActive: u => `生效中：${u}。`,
    tempOff: '已关闭。',
    h1: '1 小时', h8: '8 小时', session: '直到重启', stop: '停止',
    allowedSites: '已允许的网站',
    always: '始终',
    untilRestartShort: '直到重启',
    allowedEmpty: '暂无。批准在标签页中进行（“此网站：始终” / “此网站：直到重启”）。',
    blockedSites: '被阻止的网站',
    blockedDesc: '这些网站（包括子域名）上无法使用 Hermes，连读取也不行。',
    guardOther: '同时对 Hermes 的其他网页工具生效',
    guardOtherDesc: '关闭（默认）：列表仅适用于扩展。开启：Hermes 自己的浏览器和网页提取也会拒绝这些网站（尽力而为：在浏览器代码中拼接的地址无法识别）。',
    add: '+ 添加网站',
    blockedEmpty: '尚未添加任何网站。',
    browser: '浏览器',
    inUse: n => `Hermes 正在“${n}”中工作。下方设置属于此处选择的浏览器。`,
    noneInUse: '目前没有为 Hermes 选择浏览器（或所选浏览器未连接）。',
    hermesHere: 'Hermes 在此工作',
    useTitle: n => `让 Hermes 使用“${n}”`,
    useDesc: '之后 Hermes 的浏览器调用将发送到此浏览器。',
    use: '使用',
    waiting: n => `请在浏览器${n ? `“${n}”` : ''}中确认 …（最多等待 120 秒）`,
    confirmed: '已在浏览器中确认，已生效。',
    rejected: m => `未更改：被拒绝或未及时回应。${m ? `（${m}）` : ''}`,
    declined: '未更改：已在浏览器中拒绝。',
    expired: '未更改：120 秒内浏览器中没有回应。',
    confirmHint: '放宽限制必须在浏览器中确认。',
    safety: '安全',
    safetyDesc: 'Hermes 在此浏览器中可以做什么。收紧立即生效；放宽必须在浏览器中确认，这样 Hermes 无法自行解除自己的限制。',
    safetyOld: '此浏览器的扩展尚不支持安全设置。请更新扩展（0.9.0 或更高版本）。',
    pwWarn: 'Hermes 可以输入密码。它可以把自己知道的凭据输入密码字段。仅在需要时才保持开启。',
    tier: '级别',
    tier_read: '只读',
    tier_standard: '标准',
    tier_extended: '扩展',
    tier_full: '完全访问',
    tier_custom: '自定义',
    tierD_read: 'Hermes 可读取、截图，并查看控制台和网络。不能点击、输入、运行脚本或打开页面。',
    tierD_standard: '默认：Hermes 可读取、点击、输入并打开标签页（按网站逐一批准）。脚本在未批准的网站上不能写入，密码字段和其他网站的 iframe 被禁止。',
    tierD_extended: '在标准基础上增加：脚本可在未批准的网站上写入并打开弹出窗口，可在其他网站的 iframe 中输入，也可关闭你共享的标签页。',
    tierD_full: '全部允许，包括输入密码，且不再逐一网站询问。仅用于可信任的任务。',
    tierD_custom: '个别开关与所有级别都不同。',
    abilities: '能力',
    relaxed: '放宽保护',
    relaxedDesc: '关 = 受保护（默认）。开 = 解除保护。',
    sw_act: '点击、输入和确认对话框',
    sw_js: '运行 JavaScript',
    sw_navigate: '打开标签页并加载页面',
    sw_upload: '上传文件',
    sw_download: '将 GIF 保存到浏览器的下载文件夹',
    sw_devtools: '读取控制台和网络',
    rx_scriptWrites: '允许脚本在任何地方写入',
    rxD_scriptWrites: '在未批准的网站上，JavaScript 可发送会修改数据的请求并打开弹出窗口。',
    rx_frameTyping: '在他站 iframe 中输入',
    rxD_frameTyping: '在其他网站的 iframe 中输入（登录和支付小组件）。',
    rx_passwords: '输入密码',
    rxD_passwords: 'Hermes 可在密码字段中输入。',
    rx_closeShared: '关闭共享的标签页',
    rxD_closeShared: 'Hermes 也可关闭你自己共享的标签页，而不只是它自己的。'
  },
  'zh-hant': {
    name: '瀏覽器中的 Hermes',
    remove: '移除',
    unreachable: e => `無法連線到瀏覽器：${e}。瀏覽器是否已開啟並安裝擴充功能？`,
    loading: '載入中…',
    untilRestart: '直到瀏覽器重新啟動',
    untilTime: t => `直到 ${t}`,
    enable: '啟用瀏覽器中的 Hermes',
    enableDesc: 'Hermes 透過 hermes-tabs 擴充功能操作你瀏覽器中的分頁。關閉後：Hermes 在瀏覽器中什麼也做不了。',
    permissions: '網站權限',
    permissionsDesc: '適用於擴充功能。在已允許的網站上，讀取一律不受限制，點擊與輸入需要核准。',
    defaultAll: '所有網站的預設設定',
    defaultAllOn: 'Hermes 在除被封鎖網站以外的所有地方操作。',
    defaultAllAsk: 'Hermes 會在首次點擊某個網站之前詢問（在分頁內並透過通知）。',
    optAll: '允許所有網站',
    optAsk: '逐一網站詢問',
    tempAll: '暫時允許所有網站',
    tempActive: u => `生效中：${u}。`,
    tempOff: '已關閉。',
    h1: '1 小時', h8: '8 小時', session: '直到重新啟動', stop: '停止',
    allowedSites: '已允許的網站',
    always: '一律',
    untilRestartShort: '直到重新啟動',
    allowedEmpty: '尚無。核准在分頁中進行（「此網站：一律允許」／「此網站：直到重新啟動」）。',
    blockedSites: '被封鎖的網站',
    blockedDesc: '這些網站（包含子網域）上無法使用 Hermes，連讀取也不行。',
    guardOther: '同時對 Hermes 的其他網頁工具生效',
    guardOtherDesc: '關閉（預設）：清單僅適用於擴充功能。開啟：Hermes 自己的瀏覽器和網頁擷取也會拒絕這些網站（盡力而為：在瀏覽器程式碼中組合的網址無法辨識）。',
    add: '+ 新增網站',
    blockedEmpty: '尚未新增任何網站。',
    browser: '瀏覽器',
    inUse: n => `Hermes 正在「${n}」中工作。下方設定屬於此處選擇的瀏覽器。`,
    noneInUse: '目前沒有為 Hermes 選擇瀏覽器（或所選瀏覽器未連線）。',
    hermesHere: 'Hermes 在此工作',
    useTitle: n => `讓 Hermes 使用「${n}」`,
    useDesc: '之後 Hermes 的瀏覽器呼叫將傳送到此瀏覽器。',
    use: '使用',
    waiting: n => `請在瀏覽器${n ? `「${n}」` : ''}中確認 …（最多等待 120 秒）`,
    confirmed: '已在瀏覽器中確認，已生效。',
    rejected: m => `未變更：被拒絕或未及時回應。${m ? `（${m}）` : ''}`,
    declined: '未變更：已在瀏覽器中拒絕。',
    expired: '未變更：120 秒內瀏覽器中沒有回應。',
    confirmHint: '放寬限制必須在瀏覽器中確認。',
    safety: '安全性',
    safetyDesc: 'Hermes 在此瀏覽器中可以做什麼。收緊立即生效；放寬必須在瀏覽器中確認，這樣 Hermes 無法自行解除自己的限制。',
    safetyOld: '此瀏覽器的擴充功能尚不支援安全性設定。請更新擴充功能（0.9.0 或更新版本）。',
    pwWarn: 'Hermes 可以輸入密碼。它可以把自己知道的憑證輸入密碼欄位。僅在需要時才保持開啟。',
    tier: '等級',
    tier_read: '唯讀',
    tier_standard: '標準',
    tier_extended: '擴充',
    tier_full: '完整存取',
    tier_custom: '自訂',
    tierD_read: 'Hermes 可讀取、截圖，並查看主控台和網路。不能點擊、輸入、執行指令碼或開啟頁面。',
    tierD_standard: '預設：Hermes 可讀取、點擊、輸入並開啟分頁（依網站逐一核准）。指令碼在未核准的網站上不能寫入，密碼欄位和其他網站的 iframe 被禁止。',
    tierD_extended: '在標準基礎上增加：指令碼可在未核准的網站上寫入並開啟彈出視窗，可在其他網站的 iframe 中輸入，也可關閉你分享的分頁。',
    tierD_full: '全部允許，包括輸入密碼，且不再逐一網站詢問。僅用於可信任的工作。',
    tierD_custom: '個別開關與所有等級都不同。',
    abilities: '功能',
    relaxed: '放寬保護',
    relaxedDesc: '關 = 受保護（預設）。開 = 解除保護。',
    sw_act: '點擊、輸入與確認對話框',
    sw_js: '執行 JavaScript',
    sw_navigate: '開啟分頁並載入頁面',
    sw_upload: '上傳檔案',
    sw_download: '將 GIF 儲存到瀏覽器的下載資料夾',
    sw_devtools: '讀取主控台和網路',
    rx_scriptWrites: '允許指令碼在任何地方寫入',
    rxD_scriptWrites: '在未核准的網站上，JavaScript 可傳送會修改資料的請求並開啟彈出視窗。',
    rx_frameTyping: '在他站 iframe 中輸入',
    rxD_frameTyping: '在其他網站的 iframe 中輸入（登入與付款小工具）。',
    rx_passwords: '輸入密碼',
    rxD_passwords: 'Hermes 可在密碼欄位中輸入。',
    rx_closeShared: '關閉分享的分頁',
    rxD_closeShared: 'Hermes 也可關閉你自己分享的分頁，而不只是它自己的。'
  },
  ar: {
    name: 'Hermes في المتصفح',
    remove: 'إزالة',
    unreachable: e => `تعذّر الوصول إلى المتصفح: ${e}. هل المتصفح مفتوح ومعه الإضافة؟`,
    loading: 'جار التحميل...',
    untilRestart: 'حتى إعادة تشغيل المتصفح',
    untilTime: t => `حتى ${t}`,
    enable: 'تفعيل Hermes في المتصفح',
    enableDesc: 'يتحكم Hermes في علامات التبويب في متصفحك عبر إضافة hermes-tabs. عند الإيقاف: لا يستطيع Hermes فعل أي شيء هناك.',
    permissions: 'أذونات المواقع',
    permissionsDesc: 'تسري على الإضافة. القراءة حرة دائمًا في المواقع المسموح بها، أما النقر والكتابة فيحتاجان إلى موافقة.',
    defaultAll: 'الإعداد الافتراضي لجميع المواقع',
    defaultAllOn: 'يعمل Hermes في كل مكان باستثناء المواقع المحظورة.',
    defaultAllAsk: 'يسأل Hermes قبل أول نقرة على موقع (في علامة التبويب وعبر إشعار).',
    optAll: 'السماح بجميع المواقع',
    optAsk: 'السؤال عن كل موقع',
    tempAll: 'السماح مؤقتًا بجميع المواقع',
    tempActive: u => `مفعّل ${u}.`,
    tempOff: 'متوقف.',
    h1: 'ساعة', h8: '8 ساعات', session: 'حتى إعادة التشغيل', stop: 'إيقاف',
    allowedSites: 'المواقع المسموح بها',
    always: 'دائمًا',
    untilRestartShort: 'حتى إعادة التشغيل',
    allowedEmpty: 'لا شيء بعد. تُمنح الموافقة في علامة التبويب («الموقع: دائمًا» / «حتى إعادة التشغيل»).',
    blockedSites: 'المواقع المحظورة',
    blockedDesc: 'لا يمكن استخدام Hermes في هذه المواقع (بما فيها النطاقات الفرعية)، ولا حتى للقراءة.',
    guardOther: 'الحظر أيضًا لأدوات الويب الأخرى في Hermes',
    guardOtherDesc: 'معطّل (افتراضيًا): تسري القائمة على الإضافة فقط. مفعّل: يرفض متصفح Hermes الخاص واستخراج صفحات الويب هذه المواقع أيضًا (قدر الإمكان: لا تُكتشف العناوين المركّبة داخل شيفرة المتصفح).',
    add: '+ إضافة موقع',
    blockedEmpty: 'لم تتم إضافة أي مواقع بعد.',
    browser: 'المتصفح',
    inUse: n => `يعمل Hermes في «${n}». الإعدادات أدناه تخص المتصفح المختار هنا.`,
    noneInUse: 'لا يوجد حاليًا متصفح مختار لـ Hermes (أو أن المتصفح المختار غير متصل).',
    hermesHere: 'يعمل Hermes هنا',
    useTitle: n => `استخدام «${n}» لـ Hermes`,
    useDesc: 'ستذهب استدعاءات المتصفح من Hermes بعد ذلك إلى هذا المتصفح.',
    use: 'استخدام',
    waiting: n => `يرجى التأكيد في المتصفح${n ? ` «${n}»` : ''} … (الانتظار حتى 120 ثانية)`,
    confirmed: 'تم التأكيد في المتصفح وتطبيق التغيير.',
    rejected: m => `لم يتغير شيء: رُفض الطلب أو لم يصل ردّ في الوقت المناسب.${m ? ` (${m})` : ''}`,
    declined: 'لم يتغير شيء: رُفض الطلب في المتصفح.',
    expired: 'لم يتغير شيء: لم يصل ردّ في المتصفح خلال 120 ثانية.',
    confirmHint: 'يجب تأكيد أي تخفيف للقيود في المتصفح.',
    safety: 'الأمان',
    safetyDesc: 'ما يمكن لـ Hermes فعله في هذا المتصفح. التشديد يسري فورًا؛ أما التخفيف فيجب تأكيده في المتصفح حتى لا يستطيع Hermes رفع حدوده بنفسه.',
    safetyOld: 'إضافة هذا المتصفح لا تدعم إعدادات الأمان بعد. حدّث الإضافة (الإصدار 0.9.0 أو أحدث).',
    pwWarn: 'يستطيع Hermes إدخال كلمات المرور. يمكنه كتابة بيانات الدخول التي يعرفها في حقول كلمات المرور. أبقِ هذا مفعّلًا فقط ما دمت تحتاجه.',
    tier: 'المستوى',
    tier_read: 'قراءة فقط',
    tier_standard: 'قياسي',
    tier_extended: 'موسّع',
    tier_full: 'وصول كامل',
    tier_custom: 'مخصص',
    tierD_read: 'يقرأ Hermes ويلتقط لقطات الشاشة ويرى وحدة التحكم والشبكة. دون نقر أو كتابة أو سكربتات أو فتح صفحات.',
    tierD_standard: 'الافتراضي: يقرأ Hermes وينقر ويكتب ويفتح علامات تبويب (بموافقة لكل موقع). لا تكتب السكربتات في المواقع غير المعتمدة، وحقول كلمات المرور وإطارات iframe الغريبة ممنوعة.',
    tierD_extended: 'مثل القياسي، إضافة إلى: يمكن للسكربتات الكتابة في المواقع غير المعتمدة وفتح نوافذ منبثقة، والكتابة في إطارات iframe لمواقع أخرى، وإغلاق علامات التبويب التي شاركتها أنت أيضًا.',
    tierD_full: 'كل شيء مسموح، بما في ذلك إدخال كلمات المرور، ودون سؤال لكل موقع. للمهام الموثوقة فقط.',
    tierD_custom: 'بعض المفاتيح تختلف عن كل المستويات.',
    abilities: 'القدرات',
    relaxed: 'تخفيف الحماية',
    relaxedDesc: 'إيقاف = محمي (الافتراضي). تشغيل = رُفعت الحماية.',
    sw_act: 'النقر والكتابة وتأكيد مربعات الحوار',
    sw_js: 'تشغيل JavaScript',
    sw_navigate: 'فتح علامات تبويب وتحميل صفحات',
    sw_upload: 'رفع الملفات',
    sw_download: 'حفظ ملفات GIF في مجلد التنزيلات في المتصفح',
    sw_devtools: 'قراءة وحدة التحكم والشبكة',
    rx_scriptWrites: 'السماح للسكربتات بالكتابة في أي مكان',
    rxD_scriptWrites: 'يمكن لـ JavaScript إرسال طلبات تغيّر البيانات وفتح نوافذ منبثقة في المواقع غير المعتمدة.',
    rx_frameTyping: 'الكتابة في إطارات iframe غريبة',
    rxD_frameTyping: 'الكتابة في إطارات iframe لمواقع أخرى (أدوات تسجيل الدخول والدفع).',
    rx_passwords: 'إدخال كلمات المرور',
    rxD_passwords: 'يمكن لـ Hermes الكتابة في حقول كلمات المرور.',
    rx_closeShared: 'إغلاق علامات التبويب المشتركة',
    rxD_closeShared: 'يمكن لـ Hermes إغلاق علامات التبويب التي شاركتها أنت أيضًا، لا علاماته فقط.'
  }
}

// Safety levels (mirror of the extension): which switches each level turns on. Only used to tell whether a change
// loosens something - the relay and the extension decide for real.
const ABILITIES = ['act', 'js', 'navigate', 'upload', 'download', 'devtools']
const RELAXED = ['scriptWrites', 'frameTyping', 'passwords', 'closeShared']
const TIERS = {
  read: ['devtools'],
  standard: ABILITIES,
  extended: [...ABILITIES, 'scriptWrites', 'frameTyping', 'closeShared'],
  full: [...ABILITIES, ...RELAXED]
}

export default {
  id: ID,
  name: 'Hermes in the browser',
  register(ctx) {
    ctx.i18n.register(STR)
    // Several browsers can be connected to the relay. The page always shows and saves exactly the browser that
    // the displayed settings belong to (s.browser); without one, the relay answers for the browser Hermes uses.
    // wait: a loosening is waiting for the human's confirmation in the browser (up to 120 s); notice: its outcome
    const state = atom({ s: null, error: null, wait: false, notice: null })
    const qs = device => (device ? `?device=${encodeURIComponent(device)}` : '')
    const shown = () => state.get().s?.browser?.deviceId
    const fail = e => state.set({ ...state.get(), error: String(e?.message ?? e) })
    let seq = 0 // only the newest request may change the page (an older interval load must not switch back)

    const load = (device = shown()) => {
      const n = ++seq
      return ctx.rest(`/settings${qs(device)}`).then(
        s => n === seq && state.set({ ...state.get(), s, error: null }),
        e => n !== seq ? null : device ? load(null) : fail(e) // that browser is gone: show the one Hermes uses
      )
    }
    // Does this change loosen something? Then the human has to confirm it in the browser and the request takes a while.
    const loosens = body => {
      const { s } = state.get()
      const cur = s?.safety ?? {}
      if (body.enabled === true && s?.enabled === false) return true
      if (body.siteMode === 'all' && s?.siteMode !== 'all') return true
      if (body.allowAll && body.allowAll !== 'off') return true
      if (body.sites && Object.values(body.sites).some(v => v !== 'off')) return true
      if (body.blockedSites && (s?.blockedSites ?? []).some(d => !body.blockedSites.includes(d))) return true
      const want = body.safety?.tier ? Object.fromEntries([...ABILITIES, ...RELAXED].map(k => [k, TIERS[body.safety.tier]?.includes(k)])) : body.safety
      return !!want && Object.entries(want).some(([k, on]) => on === true && cur[k] !== true)
    }
    const save = body => {
      const n = ++seq
      const slow = loosens(body)
      if (slow) state.set({ ...state.get(), wait: true, notice: null, error: null })
      // Loosening waits for the human (extension 120 s, relay 130 s, backend 140 s): the desktop default of 15 s would cut it off.
      return ctx.rest(`/settings${qs(shown())}`, { method: 'POST', body, ...(slow && { timeoutMs: 140000 }) }).then(
        s => {
          // The relay answers 200 with confirmation: not_needed | confirmed | declined | expired; s is what applies now.
          const c = s.confirmation
          const notice = c === 'confirmed' ? { ok: true } : c === 'declined' || c === 'expired' ? { ok: false, code: c } : null
          state.set({ ...state.get(), ...(n === seq && { s, error: null }), wait: false, notice })
          return !notice || notice.ok // applied
        },
        e => {
          if (!slow) { fail(e); return false }
          // e.g. 409 "Another settings change is waiting for confirmation"
          state.set({ ...state.get(), wait: false, notice: { ok: false, msg: String(e?.message ?? e) } })
          return load().then(() => false)
        }
      )
    }
    const use = deviceId => ctx.rest('/select', { method: 'POST', body: { deviceId } }).then(() => load(deviceId), fail)
    load()
    ctx.setInterval(() => {
      if (state.get().wait) return // the pending request brings the new state itself
      state.set({ ...state.get(), notice: null })
      load()
    }, 30000)

    function SiteList({ entries, onRemove, empty, disabled }) {
      const t = usePluginI18n(ID)
      if (!entries.length) return jsx('div', { className: `py-2 text-xs ${muted}`, children: empty })
      return jsx('div', {
        children: entries.map(([label, key]) =>
          jsx(ListRow, {
            title: label,
            action: jsx(Button, { size: 'xs', variant: 'outline', disabled, onClick: () => onRemove(key), children: t('remove') })
          }, key)
        )
      })
    }

    function Page() {
      const t = usePluginI18n(ID)
      const { locale } = useI18n()
      const { s, error, wait, notice } = useValue(state)
      if (!s) {
        return jsx('div', {
          className: `p-3 text-sm ${muted}`,
          children: error ? t('unreachable', error) : t('loading')
        })
      }
      const until = s.allowAllSession ? t('untilRestart')
        : s.allowAllUntil ? t('untilTime', new Date(s.allowAllUntil).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })) : null
      const allowed = [
        ...Object.keys(s.allowedSites ?? {}).map(o => [`${o} · ${t('always')}`, ['always', o]]),
        ...Object.keys(s.sessionSites ?? {}).map(o => [`${o} · ${t('untilRestartShort')}`, ['session', o]])
      ]
      return jsxs('div', {
        className: 'flex flex-col gap-1',
        children: [
          error ? jsx('div', { className: 'text-xs text-red-500', children: error }) : null,
          wait ? jsx('div', { className: 'animate-pulse rounded-md border border-(--ui-border) p-2 text-sm', children: t('waiting', s.browser?.name) }) : null,
          notice ? jsx('div', {
            className: `text-xs ${notice.ok ? muted : 'text-red-500'}`,
            children: notice.ok ? t('confirmed') : notice.code ? t(notice.code) : t('rejected', notice.msg)
          }) : null,
          jsx(Browsers, { s, wait }),
          jsx(ToggleRow, {
            checked: s.enabled !== false,
            label: t('enable'),
            description: s.enabled === false ? `${t('enableDesc')} ${t('confirmHint')}` : t('enableDesc'),
            disabled: wait,
            onChange: on => save({ enabled: on })
          }),
          jsx(Safety, { s, wait }),
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t('permissions') }),
          jsx('div', { className: `text-xs ${muted}`, children: t('permissionsDesc') }),
          jsx(ListRow, {
            title: t('defaultAll'),
            description: s.siteMode === 'all' ? t('defaultAllOn') : `${t('defaultAllAsk')} ${t('confirmHint')}`,
            action: jsxs(Select, {
              value: s.siteMode ?? 'ask',
              disabled: wait,
              onValueChange: v => save({ siteMode: v }),
              children: [
                jsx(SelectTrigger, { className: 'w-56', children: jsx(SelectValue, {}) }),
                jsxs(SelectContent, {
                  children: [
                    jsx(SelectItem, { value: 'all', children: t('optAll') }),
                    jsx(SelectItem, { value: 'ask', children: t('optAsk') })
                  ]
                })
              ]
            })
          }),
          s.siteMode !== 'all' ? jsx(ListRow, {
            title: t('tempAll'),
            description: `${until ? t('tempActive', until) : t('tempOff')} ${t('confirmHint')}`,
            action: jsxs('div', {
              className: 'flex flex-wrap gap-1',
              children: [
                ['1h', t('h1')], ['8h', t('h8')], ['session', t('session')], ['off', t('stop')]
              ].map(([v, label]) => jsx(Button, { size: 'xs', variant: 'outline', disabled: wait, onClick: () => save({ allowAll: v }), children: label }, v))
            })
          }) : null,
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t('allowedSites') }),
          jsx(SiteList, {
            entries: allowed,
            empty: t('allowedEmpty'),
            disabled: wait,
            onRemove: ([, origin]) => save({ sites: { [origin]: 'off' } })
          }),
          jsx(BlockedSites, { s, wait })
        ]
      })
    }

    // Safety level and single switches of the displayed browser. Tightening applies at once, loosening waits for the
    // human's confirmation in the browser (save() shows the waiting state).
    function Safety({ s, wait }) {
      const t = usePluginI18n(ID)
      const sf = s.safety
      const head = [
        jsx('h3', { key: 'h', className: 'mt-4 text-sm font-medium', children: t('safety') }),
        jsx('div', { key: 'd', className: `text-xs ${muted}`, children: sf ? t('safetyDesc') : t('safetyOld') })
      ]
      if (!sf) return jsx('div', { children: head }) // older extension: no safety settings to show
      const tier = TIERS[sf.tier] ? sf.tier : 'custom'
      const set = safety => save({ safety })
      const toggles = (keys, prefix, desc) => keys.map(k =>
        jsx(ToggleRow, {
          checked: sf[k] === true,
          label: t(`${prefix}_${k}`),
          description: desc ? t(`${prefix}D_${k}`) : undefined,
          disabled: wait,
          onChange: on => set({ [k]: on })
        }, k)
      )
      return jsxs('div', {
        children: [
          ...head,
          sf.passwords === true ? jsx('div', {
            className: 'my-2 rounded-md border border-red-500/50 p-2 text-sm font-medium text-red-500',
            role: 'alert',
            children: t('pwWarn')
          }) : null,
          jsx(ListRow, {
            title: t('tier'),
            description: t(`tierD_${tier}`),
            action: jsxs(Select, {
              value: tier,
              disabled: wait,
              onValueChange: v => v !== 'custom' && v !== tier && set({ tier: v }),
              children: [
                jsx(SelectTrigger, { className: 'w-56', children: jsx(SelectValue, {}) }),
                jsx(SelectContent, {
                  children: [...Object.keys(TIERS), ...(tier === 'custom' ? ['custom'] : [])]
                    .map(v => jsx(SelectItem, { value: v, children: t(`tier_${v}`) }, v))
                })
              ]
            })
          }),
          jsx('h4', { className: 'mt-3 text-xs font-medium', children: t('abilities') }),
          ...toggles(ABILITIES, 'sw', false),
          jsx('h4', { className: 'mt-3 text-xs font-medium', children: t('relaxed') }),
          jsx('div', { className: `text-xs ${muted}`, children: t('relaxedDesc') }),
          ...toggles(RELAXED, 'rx', true),
          jsx('div', { className: `mt-1 text-xs ${muted}`, children: t('confirmHint') })
        ]
      })
    }

    function Browsers({ s, wait }) {
      const t = usePluginI18n(ID)
      const list = s.browsers ?? []
      if (!s.browser || !list.length) return null
      const inUse = list.find(b => b.inUse)
      return jsxs('div', {
        children: [
          jsx(ListRow, {
            title: t('browser'),
            description: inUse ? t('inUse', inUse.name) : t('noneInUse'),
            action: jsxs(Select, {
              value: s.browser.deviceId,
              disabled: wait,
              onValueChange: d => load(d),
              children: [
                jsx(SelectTrigger, { className: 'w-56', children: jsx(SelectValue, {}) }),
                jsx(SelectContent, {
                  children: list.map(b => jsx(SelectItem, { value: b.deviceId, children: b.inUse ? `${b.name} · ${t('hermesHere')}` : b.name }, b.deviceId))
                })
              ]
            })
          }),
          s.browser.inUse ? null : jsx(ListRow, {
            title: t('useTitle', s.browser.name),
            description: t('useDesc'),
            action: jsx(Button, { size: 'xs', variant: 'outline', disabled: wait, onClick: () => use(s.browser.deviceId), children: t('use') })
          })
        ]
      })
    }

    function BlockedSites({ s, wait }) {
      const t = usePluginI18n(ID)
      const blocked = s.blockedSites ?? []
      const add = e => {
        e.preventDefault()
        const input = e.currentTarget.elements.domain
        const d = input.value.trim()
        if (!d) return
        save({ blockedSites: [...blocked, d] }).then(ok => { if (ok) input.value = '' }) // keep the input on errors
      }
      return jsxs('div', {
        children: [
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t('blockedSites') }),
          jsx('div', { className: `text-xs ${muted}`, children: `${t('blockedDesc')} ${t('confirmHint')}` }),
          jsxs('form', {
            className: 'my-2 flex gap-2',
            onSubmit: add,
            children: [
              jsx(Input, { name: 'domain', placeholder: 'example.com', className: 'max-w-xs' }),
              jsx(Button, { type: 'submit', size: 'sm', disabled: wait, children: t('add') })
            ]
          }),
          jsx(SiteList, {
            entries: blocked.map(d => [d, d]),
            empty: t('blockedEmpty'),
            disabled: wait,
            onRemove: d => save({ blockedSites: blocked.filter(x => x !== d) })
          }),
          // Opt-in, kept on the Hermes side: the hook then also checks Hermes' own browser and web_extract.
          jsx(ToggleRow, {
            checked: s.guardOtherTools === true,
            label: t('guardOther'),
            description: t('guardOtherDesc'),
            disabled: wait,
            onChange: on => save({ guardOtherTools: on })
          })
        ]
      })
    }

    // The page title is a plain string read at registration: register again when the Hermes language changes.
    let dispose
    const addPage = () => {
      dispose?.()
      dispose = ctx.registerSettingsPage?.({ id: 'settings', title: ctx.i18n.t('name'), icon: 'browser', render: () => jsx(Page, {}) })
    }
    addPage()
    ctx.i18n.onLocaleChange(addPage)
  }
}
