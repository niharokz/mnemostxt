package ar.nih.mnemostxt

// Home-screen widgets (Android).
//
//   Recent files   2×2, 3×2, 4×2   newest files of a folder (default: the notes
//                                  folder); tap one to open it, + for a new note
//   Pinned note    2×2, 4×2        one file's text, scrollable; tap to open it
//   Quick capture  4×1             tap to write a note straight into the inbox
//
// Every widget can be resized, and has its own look (long-press → settings, or
// when it is added): theme (follow the app, follow the phone, or one of the
// built-in themes), background opacity, text size and font. Settings live in
// SharedPreferences "mnemostxt_widgets" as w<id>_<name>.
//
// The widgets read the notes folder directly (the app has "All files access").
// They refresh when you leave the app, after a share or a capture, every 30
// minutes, and with their ⟳ button.

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONObject
import java.io.File

// ── one look per widget ─────────────────────────────────────────────────────

/** A widget's colours: background, text, secondary text, accent. */
data class Palette(val bg: Int, val fg: Int, val muted: Int, val accent: Int)

object Widgets {
  const val ACTION_REFRESH = "ar.nih.mnemostxt.WIDGET_REFRESH"
  const val ACTION_OPEN = "ar.nih.mnemostxt.OPEN"
  const val EXTRA_PATH = "path"
  const val NEW_NOTE = "mnemostxt:new" // the page reads this as "new tab"
  private const val PREFS = "mnemostxt_widgets"

  /** The built-in themes of the app (frontend/src/core/themes.js): bg, fg, muted, accent. */
  val THEMES: Map<String, Pair<String, Palette>> = linkedMapOf(
    "nss-dark" to ("nss dark" to pal("#070b0f", "#e6ecec", "#8b979a", "#66bdb3")),
    "nss-light" to ("nss light" to pal("#f6f8f8", "#14201f", "#5c6b6a", "#2c6a64")),
    "solarized-dark" to ("Solarized dark" to pal("#002b36", "#93a1a1", "#657b83", "#2aa198")),
    "solarized-light" to ("Solarized light" to pal("#fdf6e3", "#586e75", "#839496", "#1f7a9e")),
    "nord" to ("Nord" to pal("#2e3440", "#d8dee9", "#9aa5b8", "#88c0d0")),
    "gruvbox" to ("Gruvbox" to pal("#282828", "#ebdbb2", "#a89984", "#83a598")),
    "dracula" to ("Dracula-style" to pal("#282a36", "#f8f8f2", "#a0a6c7", "#bd93f9")),
    "monokai" to ("Monokai-style" to pal("#272822", "#f8f8f2", "#a59f85", "#a6e22e")),
    "high-contrast" to ("High contrast" to pal("#000000", "#ffffff", "#d0d0d0", "#3ff0e0")),
  )

  private fun pal(bg: String, fg: String, muted: String, accent: String) =
    Palette(Color.parseColor(bg), Color.parseColor(fg), Color.parseColor(muted), Color.parseColor(accent))

  fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  fun get(ctx: Context, id: Int, key: String, def: String): String = prefs(ctx).getString("w${id}_$key", def) ?: def
  fun getInt(ctx: Context, id: Int, key: String, def: Int): Int = prefs(ctx).getInt("w${id}_$key", def)
  fun getBool(ctx: Context, id: Int, key: String, def: Boolean): Boolean = prefs(ctx).getBoolean("w${id}_$key", def)

  fun forget(ctx: Context, id: Int) {
    val p = prefs(ctx)
    val e = p.edit()
    p.all.keys.filter { it.startsWith("w${id}_") }.forEach { e.remove(it) }
    e.apply()
  }

  private fun dark(ctx: Context) =
    (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  /**
   * "app": the theme in the app's settings.json (a theme of your own uses its
   * colours, else the theme it is based on); "system": nss dark or light like
   * the phone; otherwise a built-in theme id.
   */
  fun palette(ctx: Context, id: Int): Palette {
    val choice = get(ctx, id, "theme", "app")
    if (choice == "system") return THEMES[if (dark(ctx)) "nss-dark" else "nss-light"]!!.second
    if (choice != "app") return THEMES[choice]?.second ?: THEMES["nss-dark"]!!.second
    return appPalette(ctx)
  }

  private fun appPalette(ctx: Context): Palette {
    val fallback = THEMES[if (dark(ctx)) "nss-dark" else "nss-light"]!!.second
    val file = Inbox.appDir(ctx)?.let { File(it, "settings.json") } ?: return fallback
    val s = try { JSONObject(file.readText()) } catch (e: Exception) { return fallback }
    val custom = s.optJSONObject("themes") ?: JSONObject()
    var id = when (val t = s.optString("theme", "nss-dark")) {
      "system" -> if (dark(ctx)) s.optString("themeDark", "nss-dark") else s.optString("themeLight", "nss-light")
      "dark" -> "nss-dark"
      "light" -> "nss-light"
      else -> t
    }
    // a theme of your own: its own colours over its base (one level is enough here)
    val own = custom.optJSONObject(id)
    if (own != null) id = own.optString("base", "nss-dark")
    val base = THEMES[id]?.second ?: fallback
    fun c(key: String, def: Int) = own?.optString(key)?.takeIf { it.matches(Regex("#[0-9a-fA-F]{6}")) }?.let { Color.parseColor(it) } ?: def
    return Palette(c("bg", base.bg), c("fg", base.fg), c("muted", base.muted), c("ink", base.accent))
  }

  /** Text size in sp: small 12, medium 14, large 16. */
  fun textSize(ctx: Context, id: Int): Float = when (get(ctx, id, "size", "medium")) { "small" -> 12f; "large" -> 16f; else -> 14f }
  fun mono(ctx: Context, id: Int, kind: String): Boolean = get(ctx, id, "font", if (kind == "pinned") "mono" else "sans") == "mono"

  /** The app is set to lock, and this widget should not show text meanwhile. */
  fun hidden(ctx: Context, id: Int): Boolean =
    Inbox.prefs(ctx).getBoolean("lock", false) && getBool(ctx, id, "hideWhenLocked", get(ctx, id, "kind", "") == "pinned")

  // ── intents ───────────────────────────────────────────────────────────────

  private fun flags(mutable: Boolean) =
    PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)

  /** Opens the app; with a path, that file (or a new tab for NEW_NOTE). */
  fun openApp(ctx: Context, path: String?, request: Int): PendingIntent {
    val i = Intent(ctx, MainActivity::class.java).setAction(ACTION_OPEN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (path != null) i.putExtra(EXTRA_PATH, path).data = Uri.parse("mnemostxt://open/" + Uri.encode(path))
    return PendingIntent.getActivity(ctx, request, i, flags(false))
  }

  /** For list rows: each row fills in its own path. */
  fun openTemplate(ctx: Context, id: Int): PendingIntent {
    val i = Intent(ctx, MainActivity::class.java).setAction(ACTION_OPEN).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(ctx, 10_000 + id, i, flags(true))
  }

  fun refresh(ctx: Context, provider: Class<*>, id: Int): PendingIntent {
    val i = Intent(ctx, provider).setAction(ACTION_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
    return PendingIntent.getBroadcast(ctx, 20_000 + id, i, flags(false))
  }

  fun capture(ctx: Context, id: Int): PendingIntent =
    PendingIntent.getActivity(ctx, 30_000 + id, Intent(ctx, CaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags(false))

  fun configure(ctx: Context, id: Int): PendingIntent {
    val i = Intent(ctx, WidgetConfigActivity::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    i.data = Uri.parse("mnemostxt://widget/$id")
    return PendingIntent.getActivity(ctx, 40_000 + id, i, flags(false))
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  val PROVIDERS: List<Class<out MnemostxtWidget>> = listOf(
    RecentWidget2x2::class.java, RecentWidget3x2::class.java, RecentWidget4x2::class.java,
    PinnedWidget2x2::class.java, PinnedWidget4x2::class.java, CaptureWidget4x1::class.java,
  )

  /** Redraws every mnemostxt widget (after leaving the app, a share or a capture). */
  fun updateAll(ctx: Context) {
    val m = AppWidgetManager.getInstance(ctx)
    for (p in PROVIDERS) {
      val ids = m.getAppWidgetIds(ComponentName(ctx, p))
      if (ids.isEmpty()) continue
      ctx.sendBroadcast(Intent(ctx, p).setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE).putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids))
    }
  }

  /** The background: a rounded shape tinted with the theme and the chosen opacity. */
  fun frame(ctx: Context, v: RemoteViews, id: Int, p: Palette) {
    v.setInt(R.id.mnemostxt_w_bg, "setColorFilter", p.bg)
    v.setInt(R.id.mnemostxt_w_bg, "setImageAlpha", (getInt(ctx, id, "opacity", 90).coerceIn(0, 100) * 255) / 100)
  }

  fun relative(f: File, root: File?): String {
    val r = root?.absolutePath?.trimEnd('/') ?: return f.parent ?: ""
    val parent = f.parentFile?.absolutePath ?: return ""
    return when {
      parent == r -> ""
      parent.startsWith("$r/") -> parent.substring(r.length + 1)
      else -> parent
    }
  }

  fun ago(ms: Long): String {
    val s = (System.currentTimeMillis() - ms) / 1000
    return when {
      s < 60 -> "now"
      s < 3600 -> "${s / 60} min"
      s < 86_400 -> "${s / 3600} h"
      s < 30 * 86_400 -> "${s / 86_400} d"
      else -> java.text.SimpleDateFormat("d MMM yyyy", java.util.Locale.getDefault()).format(java.util.Date(ms))
    }
  }

  /** The newest files under root: no dot-files, not the app folder, at most 8 levels deep. */
  fun recentFiles(root: File, skip: File?, max: Int = 40): List<File> {
    val out = ArrayList<File>()
    val stack = ArrayDeque<Pair<File, Int>>()
    stack.add(root to 0)
    var seen = 0
    val skipPath = skip?.absolutePath
    while (stack.isNotEmpty() && seen < 20_000) {
      val (dir, depth) = stack.removeLast()
      val items = dir.listFiles() ?: continue
      for (f in items) {
        seen++
        if (f.name.startsWith(".") || f.name == "node_modules") continue
        if (f.isDirectory) {
          if (depth < 8 && f.absolutePath != skipPath) stack.add(f to depth + 1)
        } else out.add(f)
      }
    }
    return out.sortedByDescending { it.lastModified() }.take(max)
  }
}

// ── the providers ───────────────────────────────────────────────────────────

/** Base of every mnemostxt widget; `kind` picks the layout. */
abstract class MnemostxtWidget : AppWidgetProvider() {
  abstract val kind: String // recent | pinned | capture

  override fun onUpdate(ctx: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) draw(ctx, manager, id)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    super.onReceive(ctx, intent)
    if (intent.action == Widgets.ACTION_REFRESH) {
      val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      if (id != AppWidgetManager.INVALID_APPWIDGET_ID) draw(ctx, AppWidgetManager.getInstance(ctx), id)
    }
  }

  override fun onDeleted(ctx: Context, ids: IntArray) {
    for (id in ids) Widgets.forget(ctx, id)
  }

  fun draw(ctx: Context, m: AppWidgetManager, id: Int) {
    Widgets.prefs(ctx).edit().putString("w${id}_kind", kind).apply()
    val p = Widgets.palette(ctx, id)
    val v = when (kind) {
      "capture" -> captureViews(ctx, id, p)
      else -> listViews(ctx, id, p)
    }
    Widgets.frame(ctx, v, id, p)
    m.updateAppWidget(id, v)
    if (kind != "capture") m.notifyAppWidgetViewDataChanged(id, R.id.mnemostxt_w_list)
  }

  private fun listViews(ctx: Context, id: Int, p: Palette): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.mnemostxt_widget_list)
    val notes = Inbox.notesDir(ctx)
    val title: String
    val openPath: String?
    if (kind == "pinned") {
      val path = Widgets.get(ctx, id, "file", "")
      title = if (path.isEmpty()) "Pinned note" else File(path).name
      openPath = path.ifEmpty { null }
      v.setTextViewText(R.id.mnemostxt_w_action, "↗")
      v.setOnClickPendingIntent(R.id.mnemostxt_w_action, Widgets.openApp(ctx, openPath, 50_000 + id))
    } else {
      val folder = Widgets.get(ctx, id, "folder", "")
      title = if (folder.isEmpty() || folder == notes?.absolutePath) "Recent" else File(folder).name
      openPath = null
      v.setTextViewText(R.id.mnemostxt_w_action, "+")
      v.setOnClickPendingIntent(R.id.mnemostxt_w_action, Widgets.openApp(ctx, Widgets.NEW_NOTE, 50_000 + id))
    }
    v.setTextViewText(R.id.mnemostxt_w_title, title)
    v.setTextColor(R.id.mnemostxt_w_title, p.accent)
    v.setTextColor(R.id.mnemostxt_w_refresh, p.muted)
    v.setTextColor(R.id.mnemostxt_w_action, p.accent)
    v.setTextColor(R.id.mnemostxt_w_empty, p.muted)
    v.setTextViewTextSize(R.id.mnemostxt_w_title, TypedValue.COMPLEX_UNIT_SP, Widgets.textSize(ctx, id) + 1)
    v.setTextViewText(R.id.mnemostxt_w_empty, when {
      notes == null -> "Open MnemoTXT once to choose your notes folder"
      Widgets.hidden(ctx, id) -> "🔒 Locked — tap to open"
      kind == "pinned" && openPath == null -> "Long-press → settings to choose a note"
      else -> "Nothing here yet"
    })
    v.setOnClickPendingIntent(R.id.mnemostxt_w_title, Widgets.configure(ctx, id))
    v.setOnClickPendingIntent(R.id.mnemostxt_w_refresh, Widgets.refresh(ctx, javaClass, id))
    v.setOnClickPendingIntent(R.id.mnemostxt_w_empty, Widgets.openApp(ctx, openPath, 60_000 + id))
    // the list: one row per file (recent) or per line (pinned)
    val svc = Intent(ctx, WidgetListService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
    svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
    @Suppress("DEPRECATION") // RemoteCollectionItems needs API 31; this works everywhere
    v.setRemoteAdapter(R.id.mnemostxt_w_list, svc)
    v.setEmptyView(R.id.mnemostxt_w_list, R.id.mnemostxt_w_empty)
    v.setPendingIntentTemplate(R.id.mnemostxt_w_list, Widgets.openTemplate(ctx, id))
    return v
  }

  private fun captureViews(ctx: Context, id: Int, p: Palette): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.mnemostxt_widget_capture)
    v.setTextColor(R.id.mnemostxt_w_hint, p.muted)
    v.setTextColor(R.id.mnemostxt_w_title, p.accent)
    v.setTextColor(R.id.mnemostxt_w_action, p.accent)
    v.setTextViewTextSize(R.id.mnemostxt_w_hint, TypedValue.COMPLEX_UNIT_SP, Widgets.textSize(ctx, id) + 1)
    v.setTextViewText(R.id.mnemostxt_w_hint, "Write a note… → ${Inbox.inboxName(ctx)}/")
    v.setOnClickPendingIntent(R.id.mnemostxt_w_hint, Widgets.capture(ctx, id))
    v.setOnClickPendingIntent(R.id.mnemostxt_w_title, Widgets.openApp(ctx, null, 70_000 + id))
    v.setOnClickPendingIntent(R.id.mnemostxt_w_action, Widgets.openApp(ctx, Widgets.NEW_NOTE, 80_000 + id))
    return v
  }
}

class RecentWidget2x2 : MnemostxtWidget() { override val kind = "recent" }
class RecentWidget3x2 : MnemostxtWidget() { override val kind = "recent" }
class RecentWidget4x2 : MnemostxtWidget() { override val kind = "recent" }
class PinnedWidget2x2 : MnemostxtWidget() { override val kind = "pinned" }
class PinnedWidget4x2 : MnemostxtWidget() { override val kind = "pinned" }
class CaptureWidget4x1 : MnemostxtWidget() { override val kind = "capture" }

// ── the rows of the list widgets ────────────────────────────────────────────

class WidgetListService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    ListFactory(applicationContext, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0))
}

/** Recent: one row per file (name, folder · age). Pinned: one row per line of the note. */
class ListFactory(private val ctx: Context, private val id: Int) : RemoteViewsService.RemoteViewsFactory {
  private class Row(val text: String, val meta: String, val path: String?)
  private var rows: List<Row> = emptyList()
  private var p = Widgets.THEMES["nss-dark"]!!.second
  private var size = 14f
  private var mono = false

  override fun onCreate() {}
  override fun onDestroy() {}
  override fun getCount() = rows.size
  override fun getLoadingView(): RemoteViews? = null
  override fun getViewTypeCount() = 4 // row, row (mono), line, line (mono)
  override fun getItemId(position: Int) = position.toLong()
  override fun hasStableIds() = false

  override fun onDataSetChanged() {
    val kind = Widgets.get(ctx, id, "kind", "recent")
    p = Widgets.palette(ctx, id)
    size = Widgets.textSize(ctx, id)
    mono = Widgets.mono(ctx, id, kind)
    val notes = Inbox.notesDir(ctx)
    rows = if (notes == null || Widgets.hidden(ctx, id)) emptyList() else try {
      if (kind == "pinned") lines() else recent(notes)
    } catch (e: Exception) {
      listOf(Row("Cannot read: ${e.message}", "", null))
    }
  }

  private fun recent(notes: File): List<Row> {
    val folder = Widgets.get(ctx, id, "folder", "").ifEmpty { notes.absolutePath }
    val root = File(folder).takeIf { it.isDirectory } ?: notes
    return Widgets.recentFiles(root, Inbox.appDir(ctx)).map { f ->
      val dir = Widgets.relative(f, root)
      Row(f.name, (if (dir.isEmpty()) "" else "$dir · ") + Widgets.ago(f.lastModified()), f.absolutePath)
    }
  }

  private fun lines(): List<Row> {
    val path = Widgets.get(ctx, id, "file", "")
    if (path.isEmpty()) return emptyList()
    val f = File(path)
    if (!f.isFile) return listOf(Row("${f.name} is gone (moved or deleted)", "", null))
    val text = f.inputStream().use { s -> String(s.readNBytesCompat(64 * 1024), Charsets.UTF_8) }
    return text.replace("\r\n", "\n").split('\n').take(400).map { Row(it.ifEmpty { " " }, "", path) }
  }

  override fun getViewAt(position: Int): RemoteViews {
    val r = rows.getOrNull(position) ?: return RemoteViews(ctx.packageName, R.layout.mnemostxt_widget_row)
    val pinned = r.meta.isEmpty()
    val layout = when {
      pinned && mono -> R.layout.mnemostxt_widget_line_mono
      pinned -> R.layout.mnemostxt_widget_line
      mono -> R.layout.mnemostxt_widget_row_mono
      else -> R.layout.mnemostxt_widget_row
    }
    val v = RemoteViews(ctx.packageName, layout)
    v.setTextViewText(R.id.mnemostxt_w_row_text, r.text)
    v.setTextColor(R.id.mnemostxt_w_row_text, p.fg)
    v.setTextViewTextSize(R.id.mnemostxt_w_row_text, TypedValue.COMPLEX_UNIT_SP, size)
    if (!pinned) {
      v.setTextViewText(R.id.mnemostxt_w_row_meta, r.meta)
      v.setTextColor(R.id.mnemostxt_w_row_meta, p.muted)
      v.setTextViewTextSize(R.id.mnemostxt_w_row_meta, TypedValue.COMPLEX_UNIT_SP, size - 2)
    }
    if (r.path != null) v.setOnClickFillInIntent(R.id.mnemostxt_w_row, Intent().putExtra(Widgets.EXTRA_PATH, r.path))
    v.setViewVisibility(R.id.mnemostxt_w_row, View.VISIBLE)
    return v
  }
}

/** InputStream.readNBytes needs API 33. */
private fun java.io.InputStream.readNBytesCompat(n: Int): ByteArray {
  val buf = ByteArray(n)
  var off = 0
  while (off < n) {
    val r = read(buf, off, n - off)
    if (r < 0) break
    off += r
  }
  return buf.copyOf(off)
}
