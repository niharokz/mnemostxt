package ar.nih.mnemostxt

// "Share to mnemostxt": saves what another app shares into the inbox folder
// of the notes folder (Preferences → This device → Share saves in; default
// <notes>/inbox), then closes at once.
//  - Text becomes <date>_<time>.md (e.g. 2026-11-07_14-03-09.md); a shared
//    subject becomes its first line as a heading.
//  - Files (one or many) are copied with their own names; a name already in
//    the inbox gets " (2)", " (3)"… instead of being overwritten.
// It needs no unlocking: it can only add files, never read them.

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class ShareActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val prefs = getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE)
    val notes = prefs.getString("notesDir", null)
    val inbox = (prefs.getString("inbox", "inbox") ?: "inbox").trim('/')
    val message = when {
      notes == null -> "Open mnemostxt once and choose your notes folder first"
      inbox.split('/').any { it == ".." || it.isEmpty() } -> "The inbox folder setting is not valid"
      else -> try {
        val dir = File(notes, inbox)
        if (!dir.isDirectory && !dir.mkdirs()) throw IllegalStateException("cannot create ${dir.path}")
        val saved = save(intent, dir)
        if (saved.isEmpty()) "Nothing to save" else if (saved.size == 1) "Saved to $inbox/${saved[0]}" else "Saved ${saved.size} files to $inbox"
      } catch (e: Exception) {
        "Not saved: ${e.message}"
      }
    }
    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    finish()
  }

  /** Returns the names written. */
  private fun save(intent: Intent, dir: File): List<String> {
    val streams = streamsOf(intent)
    if (streams.isNotEmpty()) return streams.map { copy(it, dir) }
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() ?: return emptyList()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
    val body = if (subject.isNotEmpty() && !text.startsWith(subject)) "# $subject\n\n$text\n" else "$text\n"
    val stamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.ROOT).format(Date())
    val file = unique(dir, "$stamp.md")
    file.writeText(body)
    return listOf(file.name)
  }

  @Suppress("DEPRECATION") // the typed getParcelable… needs API 33; these work everywhere
  private fun streamsOf(intent: Intent): List<Uri> = when (intent.action) {
    Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
    Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
    else -> emptyList()
  }

  private fun copy(uri: Uri, dir: File): String {
    val name = displayName(uri)?.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "_")?.takeIf { it.isNotBlank() && it != "." && it != ".." } ?: "shared"
    val file = unique(dir, name)
    contentResolver.openInputStream(uri).use { input ->
      requireNotNull(input) { "cannot read $name" }
      file.outputStream().use { input.copyTo(it) }
    }
    return file.name
  }

  private fun displayName(uri: Uri): String? =
    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    } ?: uri.lastPathSegment?.substringAfterLast('/')

  /** name.md, name (2).md, name (3).md … */
  private fun unique(dir: File, name: String): File {
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
