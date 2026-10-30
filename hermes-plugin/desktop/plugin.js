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
    permissionsDesc: 'These apply to the extension; blocked sites also apply to Hermes’ own browser. Reading is always free on allowed sites, clicking and typing need approval.',
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
    add: '+ Add website',
    blockedEmpty: 'No websites added yet.',
    browser: 'Browser',
    inUse: n => `Hermes works in “${n}”. The settings below belong to the browser chosen here.`,
    noneInUse: 'No browser is chosen for Hermes right now (or the chosen one is not connected).',
    hermesHere: 'Hermes works here',
    useTitle: n => `Use “${n}” for Hermes`,
    useDesc: 'Hermes’ browser calls then go to this browser.',
    use: 'Use'
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
    permissionsDesc: 'Gelten für die Extension; blockierte Seiten auch für Hermes’ eigenen Browser. Lesen ist auf erlaubten Seiten immer frei, Klicken und Tippen braucht die Freigabe.',
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
    add: '+ Website hinzufügen',
    blockedEmpty: 'Noch keine Websites hinzugefügt.',
    browser: 'Browser',
    inUse: n => `Hermes arbeitet in „${n}“. Die Einstellungen unten gehören zum hier gewählten Browser.`,
    noneInUse: 'Für Hermes ist gerade kein Browser gewählt (oder der gewählte ist nicht verbunden).',
    hermesHere: 'Hermes arbeitet hier',
    useTitle: n => `„${n}“ für Hermes verwenden`,
    useDesc: 'Hermes’ Browser-Aufrufe gehen dann an diesen Browser.',
    use: 'Verwenden'
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
    permissionsDesc: 'S’appliquent à l’extension ; les sites bloqués valent aussi pour le navigateur propre à Hermes. La lecture est toujours libre sur les sites autorisés ; cliquer et saisir demandent une approbation.',
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
    add: '+ Ajouter un site web',
    blockedEmpty: 'Aucun site web ajouté pour l’instant.',
    browser: 'Navigateur',
    inUse: n => `Hermes travaille dans « ${n} ». Les réglages ci-dessous concernent le navigateur choisi ici.`,
    noneInUse: 'Aucun navigateur n’est choisi pour Hermes actuellement (ou le navigateur choisi n’est pas connecté).',
    hermesHere: 'Hermes travaille ici',
    useTitle: n => `Utiliser « ${n} » pour Hermes`,
    useDesc: 'Les appels de navigateur de Hermes iront alors vers ce navigateur.',
    use: 'Utiliser'
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
    permissionsDesc: 'Se aplican a la extensión; los sitios bloqueados también valen para el navegador propio de Hermes. Leer es siempre libre en los sitios permitidos; hacer clic y escribir requieren aprobación.',
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
    add: '+ Añadir sitio web',
    blockedEmpty: 'Aún no se ha añadido ningún sitio web.',
    browser: 'Navegador',
    inUse: n => `Hermes trabaja en «${n}». Los ajustes de abajo pertenecen al navegador elegido aquí.`,
    noneInUse: 'Ahora mismo no hay ningún navegador elegido para Hermes (o el elegido no está conectado).',
    hermesHere: 'Hermes trabaja aquí',
    useTitle: n => `Usar «${n}» para Hermes`,
    useDesc: 'Las llamadas de navegador de Hermes irán entonces a este navegador.',
    use: 'Usar'
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
    permissionsDesc: 'Действуют для расширения; заблокированные сайты действуют и для собственного браузера Hermes. Чтение на разрешённых сайтах всегда свободно, клики и ввод требуют подтверждения.',
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
    add: '+ Добавить сайт',
    blockedEmpty: 'Сайты пока не добавлены.',
    browser: 'Браузер',
    inUse: n => `Hermes работает в «${n}». Настройки ниже относятся к выбранному здесь браузеру.`,
    noneInUse: 'Сейчас для Hermes не выбран браузер (или выбранный не подключён).',
    hermesHere: 'Hermes работает здесь',
    useTitle: n => `Использовать «${n}» для Hermes`,
    useDesc: 'Вызовы браузера из Hermes будут направляться в этот браузер.',
    use: 'Использовать'
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
    permissionsDesc: '拡張機能に適用されます。ブロックしたサイトは Hermes 自身のブラウザーにも適用されます。許可したサイトでは閲覧は常に自由で、クリックと入力には承認が必要です。',
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
    add: '+ ウェブサイトを追加',
    blockedEmpty: 'ウェブサイトはまだ追加されていません。',
    browser: 'ブラウザー',
    inUse: n => `Hermes は「${n}」で動作しています。以下の設定は、ここで選んだブラウザーのものです。`,
    noneInUse: '現在、Hermes 用のブラウザーが選ばれていません（または選ばれたブラウザーが接続されていません）。',
    hermesHere: 'Hermes はここで動作中',
    useTitle: n => `Hermes に「${n}」を使う`,
    useDesc: '以降、Hermes のブラウザー呼び出しはこのブラウザーに送られます。',
    use: '使用'
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
    permissionsDesc: '适用于扩展；被阻止的网站同样适用于 Hermes 自己的浏览器。在已允许的网站上，读取始终不受限制，点击和输入需要批准。',
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
    add: '+ 添加网站',
    blockedEmpty: '尚未添加任何网站。',
    browser: '浏览器',
    inUse: n => `Hermes 正在“${n}”中工作。下方设置属于此处选择的浏览器。`,
    noneInUse: '目前没有为 Hermes 选择浏览器（或所选浏览器未连接）。',
    hermesHere: 'Hermes 在此工作',
    useTitle: n => `让 Hermes 使用“${n}”`,
    useDesc: '之后 Hermes 的浏览器调用将发送到此浏览器。',
    use: '使用'
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
    permissionsDesc: '適用於擴充功能；被封鎖的網站同樣適用於 Hermes 自己的瀏覽器。在已允許的網站上，讀取一律不受限制，點擊與輸入需要核准。',
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
    add: '+ 新增網站',
    blockedEmpty: '尚未新增任何網站。',
    browser: '瀏覽器',
    inUse: n => `Hermes 正在「${n}」中工作。下方設定屬於此處選擇的瀏覽器。`,
    noneInUse: '目前沒有為 Hermes 選擇瀏覽器（或所選瀏覽器未連線）。',
    hermesHere: 'Hermes 在此工作',
    useTitle: n => `讓 Hermes 使用「${n}」`,
    useDesc: '之後 Hermes 的瀏覽器呼叫將傳送到此瀏覽器。',
    use: '使用'
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
    permissionsDesc: 'تسري على الإضافة؛ والمواقع المحظورة تسري أيضًا على متصفح Hermes الخاص. القراءة حرة دائمًا في المواقع المسموح بها، أما النقر والكتابة فيحتاجان إلى موافقة.',
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
    add: '+ إضافة موقع',
    blockedEmpty: 'لم تتم إضافة أي مواقع بعد.',
    browser: 'المتصفح',
    inUse: n => `يعمل Hermes في «${n}». الإعدادات أدناه تخص المتصفح المختار هنا.`,
    noneInUse: 'لا يوجد حاليًا متصفح مختار لـ Hermes (أو أن المتصفح المختار غير متصل).',
    hermesHere: 'يعمل Hermes هنا',
    useTitle: n => `استخدام «${n}» لـ Hermes`,
    useDesc: 'ستذهب استدعاءات المتصفح من Hermes بعد ذلك إلى هذا المتصفح.',
    use: 'استخدام'
  }
}

export default {
  id: ID,
  name: 'Hermes in the browser',
  register(ctx) {
    ctx.i18n.register(STR)
    // Several browsers can be connected to the relay. The page always shows and saves exactly the browser that
    // the displayed settings belong to (s.browser); without one, the relay answers for the browser Hermes uses.
    const state = atom({ s: null, error: null })
    const qs = device => (device ? `?device=${encodeURIComponent(device)}` : '')
    const shown = () => state.get().s?.browser?.deviceId
    const fail = e => state.set({ ...state.get(), error: String(e?.message ?? e) })
    let seq = 0 // only the newest request may change the page (an older interval load must not switch back)

    const load = (device = shown()) => {
      const n = ++seq
      return ctx.rest(`/settings${qs(device)}`).then(
        s => n === seq && state.set({ s, error: null }),
        e => n !== seq ? null : device ? load(null) : fail(e) // that browser is gone: show the one Hermes uses
      )
    }
    const save = body => {
      const n = ++seq
      return ctx.rest(`/settings${qs(shown())}`, { method: 'POST', body }).then(s => n === seq && state.set({ s, error: null }), fail)
    }
    const use = deviceId => ctx.rest('/select', { method: 'POST', body: { deviceId } }).then(() => load(deviceId), fail)
    load()
    ctx.setInterval(() => load(), 30000)

    function SiteList({ entries, onRemove, empty }) {
      const t = usePluginI18n(ID)
      if (!entries.length) return jsx('div', { className: `py-2 text-xs ${muted}`, children: empty })
      return jsx('div', {
        children: entries.map(([label, key]) =>
          jsx(ListRow, {
            title: label,
            action: jsx(Button, { size: 'xs', variant: 'outline', onClick: () => onRemove(key), children: t('remove') })
          }, key)
        )
      })
    }

    function Page() {
      const t = usePluginI18n(ID)
      const { locale } = useI18n()
      const { s, error } = useValue(state)
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
          jsx(Browsers, { s }),
          jsx(ToggleRow, {
            checked: s.enabled !== false,
            label: t('enable'),
            description: t('enableDesc'),
            onChange: on => save({ enabled: on })
          }),
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t('permissions') }),
          jsx('div', { className: `text-xs ${muted}`, children: t('permissionsDesc') }),
          jsx(ListRow, {
            title: t('defaultAll'),
            description: s.siteMode === 'all' ? t('defaultAllOn') : t('defaultAllAsk'),
            action: jsxs(Select, {
              value: s.siteMode ?? 'ask',
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
            description: until ? t('tempActive', until) : t('tempOff'),
            action: jsxs('div', {
              className: 'flex flex-wrap gap-1',
              children: [
                ['1h', t('h1')], ['8h', t('h8')], ['session', t('session')], ['off', t('stop')]
              ].map(([v, label]) => jsx(Button, { size: 'xs', variant: 'outline', onClick: () => save({ allowAll: v }), children: label }, v))
            })
          }) : null,
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t('allowedSites') }),
          jsx(SiteList, {
            entries: allowed,
            empty: t('allowedEmpty'),
            onRemove: ([, origin]) => save({ sites: { [origin]: 'off' } })
          }),
          jsx(BlockedSites, { s })
        ]
      })
    }

    function Browsers({ s }) {
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
            action: jsx(Button, { size: 'xs', variant: 'outline', onClick: () => use(s.browser.deviceId), children: t('use') })
          })
        ]
      })
    }

    function BlockedSites({ s }) {
      const t = usePluginI18n(ID)
      const blocked = s.blockedSites ?? []
      const add = e => {
        e.preventDefault()
        const input = e.currentTarget.elements.domain
        const d = input.value.trim()
        if (!d) return
        save({ blockedSites: [...blocked, d] }).then(() => { input.value = '' })
      }
      return jsxs('div', {
        children: [
          jsx('h3', { className: 'mt-4 text-sm font-medium', children: t('blockedSites') }),
          jsx('div', { className: `text-xs ${muted}`, children: t('blockedDesc') }),
          jsxs('form', {
            className: 'my-2 flex gap-2',
            onSubmit: add,
            children: [
              jsx(Input, { name: 'domain', placeholder: 'example.com', className: 'max-w-xs' }),
              jsx(Button, { type: 'submit', size: 'sm', children: t('add') })
            ]
          }),
          jsx(SiteList, {
            entries: blocked.map(d => [d, d]),
            empty: t('blockedEmpty'),
            onRemove: d => save({ blockedSites: blocked.filter(x => x !== d) })
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
