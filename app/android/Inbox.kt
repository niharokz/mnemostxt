package ar.nih.mnemostxt

// Shared by "Share to mnemostxt" (ShareActivity), the Quick capture widget
// (CaptureActivity) and the widgets: where the notes folder is, and how a new
// note lands in the inbox. The page tells MainActivity these settings
// (MnemostxtAndroid.configure); they are kept in SharedPreferences "mnemostxt".

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Inbox {
  fun prefs(ctx: Context) = ctx.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)

  /** The notes folder, or null before the app was opened once. */
  fun notesDir(ctx: Context): File? = prefs(ctx).getString("notesDir", null)?.let { File(it) }?.takeIf { it.isDirectory }

  /** The app folder inside the notes folder (settings, trash, scratch, state). */
  fun appDir(ctx: Context): File? = notesDir(ctx)?.let { File(it, prefs(ctx).getString("appDir", "logs/mnemostxt") ?: "logs/mnemostxt") }

  /** <notes>/<inbox>, created when missing. Throws with a readable message. */
  fun dir(ctx: Context): File {
    val notes = notesDir(ctx) ?: throw IllegalStateException("Open MnemoTXT once and choose your notes folder first")
    val inbox = (prefs(ctx).getString("inbox", "inbox") ?: "inbox").trim('/')
    if (inbox.isEmpty() || inbox.split('/').any { it == ".." || it.isEmpty() }) throw IllegalStateException("The inbox folder setting is not valid")
    val dir = File(notes, inbox)
    if (!dir.isDirectory && !dir.mkdirs()) throw IllegalStateException("cannot create ${dir.path}")
    return dir
  }

  fun inboxName(ctx: Context): String = (prefs(ctx).getString("inbox", "inbox") ?: "inbox").trim('/')

  /** Saves text as <inbox>/<date>_<time>.md; a subject becomes a heading. Returns the file. */
  fun saveText(ctx: Context, text: String, subject: String = ""): File {
    val body = if (subject.isNotEmpty() && !text.startsWith(subject)) "# $subject\n\n$text\n" else "$text\n"
    val stamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.ROOT).format(Date())
    val file = unique(dir(ctx), "$stamp.md")
    file.writeText(body)
    return file
  }

  /** name.md, name (2).md, name (3).md … */
  fun unique(dir: File, name: String): File {
    var f = File(dir, name)
    val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
    var n = 2
    while (f.exists()) {
      f = File(dir, "${name.substring(0, dot)} ($n)${name.substring(dot)}")
      n++
    }
    return f
  }
}
