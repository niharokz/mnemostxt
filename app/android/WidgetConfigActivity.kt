package ar.nih.mnemostxt

// Settings of one widget, shown when it is added and on long-press → settings
// (or a tap on the widget's title): the folder (Recent) or the note (Pinned),
// theme, background opacity, text size, font, and whether the text hides
// while mnemostxt's lock is on. Nothing is saved until "Save".

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import java.io.File

class WidgetConfigActivity : Activity() {
  private var id = AppWidgetManager.INVALID_APPWIDGET_ID
  private lateinit var kind: String
  private var folder = ""
  private var file = ""
  private var theme = "app"
  private var opacity = 90
  private var size = "medium"
  private var font = "sans"
  private var hideWhenLocked = false

  private val bg = Color.parseColor("#070B0F")
  private val fg = Color.parseColor("#E6ECEC")
  private val muted = Color.parseColor("#8B979A")
  private val ink = Color.parseColor("#66BDB3")

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
    val info = AppWidgetManager.getInstance(this).getAppWidgetInfo(id)
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID || info == null || info.provider.packageName != packageName) { finish(); return }
    val cls = info.provider.className
    kind = when { cls.contains("Pinned") -> "pinned"; cls.contains("Capture") -> "capture"; else -> "recent" }
    folder = Widgets.get(this, id, "folder", "")
    file = Widgets.get(this, id, "file", "")
    theme = Widgets.get(this, id, "theme", "app")
    opacity = Widgets.getInt(this, id, "opacity", 90)
    size = Widgets.get(this, id, "size", "medium")
    font = Widgets.get(this, id, "font", if (kind == "pinned") "mono" else "sans")
    hideWhenLocked = Widgets.getBool(this, id, "hideWhenLocked", kind == "pinned")
    build()
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private fun label(text: String, big: Boolean = false) = TextView(this).apply {
    this.text = text
    setTextColor(if (big) fg else ink)
    textSize = if (big) 20f else 13f
    setPadding(0, dp(if (big) 4 else 18), 0, dp(6))
  }

  private fun note(text: String) = TextView(this).apply { this.text = text; setTextColor(muted); textSize = 13f }

  private fun radios(options: List<Pair<String, String>>, current: String, horizontal: Boolean, pick: (String) -> Unit) =
    RadioGroup(this).apply {
      orientation = if (horizontal) RadioGroup.HORIZONTAL else RadioGroup.VERTICAL
      options.forEachIndexed { i, (value, text) ->
        val b = RadioButton(this@WidgetConfigActivity).apply {
          this.id = View.generateViewId()
          this.text = text
          setTextColor(fg)
          isChecked = value == current
          setOnClickListener { pick(value) }
        }
        addView(b)
        if (i == 0 && options.none { it.first == current }) b.isChecked = true
      }
    }

  private fun build() {
    val notes = Inbox.notesDir(this)
    val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20)) }
    col.addView(label(when (kind) { "pinned" -> "Pinned note"; "capture" -> "Quick capture"; else -> "Recent files" }, big = true))
    if (notes == null) col.addView(note("Open mnemostxt once and choose your notes folder first."))

    if (kind == "recent") {
      col.addView(label("Folder"))
      val shown = TextView(this).apply { setTextColor(fg); text = folder.ifEmpty { "The notes folder" } }
      col.addView(shown)
      col.addView(Button(this).apply {
        text = "Choose folder…"
        isEnabled = notes != null
        setOnClickListener { pickFolder(notes!!) { folder = it; shown.text = it.ifEmpty { "The notes folder" } } }
      })
    }
    if (kind == "pinned") {
      col.addView(label("Note"))
      val shown = TextView(this).apply { setTextColor(fg); text = file.ifEmpty { "None chosen" } }
      col.addView(shown)
      col.addView(Button(this).apply {
        text = "Choose note…"
        isEnabled = notes != null
        setOnClickListener { pickFile(notes!!) { file = it; shown.text = it } }
      })
    }

    col.addView(label("Theme"))
    val themes = listOf("app" to "Like the app", "system" to "Like the phone (nss dark / light)") + Widgets.THEMES.map { it.key to it.value.first }
    col.addView(radios(themes, theme, false) { theme = it })

    col.addView(label("Background opacity"))
    val pct = TextView(this).apply { setTextColor(fg); text = "$opacity %" }
    col.addView(pct)
    col.addView(SeekBar(this).apply {
      max = 100
      progress = opacity
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(s: SeekBar, value: Int, fromUser: Boolean) { opacity = value; pct.text = "$value %" }
        override fun onStartTrackingTouch(s: SeekBar) {}
        override fun onStopTrackingTouch(s: SeekBar) {}
      })
    })

    if (kind != "capture") {
      col.addView(label("Text size"))
      col.addView(radios(listOf("small" to "Small", "medium" to "Medium", "large" to "Large"), size, true) { size = it })
      col.addView(label("Font"))
      col.addView(radios(listOf("sans" to "Sans", "mono" to "Monospace"), font, true) { font = it })
      col.addView(CheckBox(this).apply {
        text = "Hide the text while mnemostxt's lock is on"
        setTextColor(fg)
        isChecked = hideWhenLocked
        setOnCheckedChangeListener { _, on -> hideWhenLocked = on }
      })
    } else {
      col.addView(label("Text size"))
      col.addView(radios(listOf("small" to "Small", "medium" to "Medium", "large" to "Large"), size, true) { size = it })
    }

    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
      setPadding(0, dp(20), 0, 0)
      addView(Button(this@WidgetConfigActivity).apply { text = "Cancel"; setOnClickListener { finish() } })
      addView(Button(this@WidgetConfigActivity).apply { text = "Save"; setOnClickListener { save() } })
    }
    col.addView(buttons)
    setContentView(ScrollView(this).apply {
      setBackgroundColor(bg)
      addView(col, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    })
  }

  private fun save() {
    if (kind == "pinned" && file.isEmpty()) { Toast.makeText(this, "Choose a note first", Toast.LENGTH_SHORT).show(); return }
    Widgets.prefs(this).edit()
      .putString("w${id}_kind", kind)
      .putString("w${id}_folder", folder)
      .putString("w${id}_file", file)
      .putString("w${id}_theme", theme)
      .putInt("w${id}_opacity", opacity)
      .putString("w${id}_size", size)
      .putString("w${id}_font", font)
      .putBoolean("w${id}_hideWhenLocked", hideWhenLocked)
      .apply()
    Widgets.updateAll(this)
    setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
    finish()
  }

  // ── pickers: a list of the notes folder (no system picker needed) ─────────

  private fun rel(f: File, notes: File) = f.absolutePath.removePrefix(notes.absolutePath).trimStart('/')

  private fun pickFolder(notes: File, done: (String) -> Unit) {
    val app = Inbox.appDir(this)?.absolutePath
    val dirs = ArrayList<File>()
    val stack = ArrayDeque(listOf(notes))
    while (stack.isNotEmpty() && dirs.size < 2000) {
      val d = stack.removeLast()
      d.listFiles()?.filter { it.isDirectory && !it.name.startsWith(".") && it.absolutePath != app }?.sortedBy { it.name.lowercase() }?.forEach { dirs.add(it); stack.add(it) }
    }
    dirs.sortBy { rel(it, notes).lowercase() }
    val names = arrayOf("(the notes folder)") + dirs.map { rel(it, notes) }
    AlertDialog.Builder(this).setTitle("Folder").setItems(names) { _, i -> done(if (i == 0) "" else dirs[i - 1].absolutePath) }.show()
  }

  private fun pickFile(notes: File, done: (String) -> Unit) {
    val recent = Widgets.recentFiles(notes, Inbox.appDir(this), 300).sortedBy { rel(it, notes).lowercase() }
    if (recent.isEmpty()) { Toast.makeText(this, "No files in the notes folder", Toast.LENGTH_SHORT).show(); return }
    AlertDialog.Builder(this).setTitle("Note").setItems(recent.map { rel(it, notes) }.toTypedArray()) { _, i -> done(recent[i].absolutePath) }.show()
  }
}
