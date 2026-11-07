package ar.nih.mnemostxt

// The Quick capture widget's little window: type, Save, and the text lands in
// <notes>/<inbox>/<date>_<time>.md (like "Share to mnemostxt"). It only adds
// a file, so it does not ask for the lock.

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class CaptureActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val dp = resources.displayMetrics.density
    val pad = (16 * dp).toInt()
    val title = TextView(this).apply {
      text = "New note → ${Inbox.inboxName(this@CaptureActivity)}/"
      setTextColor(Color.parseColor("#66BDB3"))
      textSize = 15f
    }
    val input = EditText(this).apply {
      hint = "Write it down…"
      minLines = 4
      maxLines = 12
      gravity = Gravity.TOP or Gravity.START
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      setTextColor(Color.parseColor("#E6ECEC"))
      setHintTextColor(Color.parseColor("#8B979A"))
    }
    val cancel = Button(this).apply { text = "Cancel"; setOnClickListener { finish() } }
    val save = Button(this).apply {
      text = "Save"
      setOnClickListener {
        val text = input.text.toString().trimEnd()
        if (text.isBlank()) { finish(); return@setOnClickListener }
        val msg = try {
          val f = Inbox.saveText(this@CaptureActivity, text)
          Widgets.updateAll(this@CaptureActivity)
          "Saved to ${Inbox.inboxName(this@CaptureActivity)}/${f.name}"
        } catch (e: Exception) {
          if (e is IllegalStateException) e.message ?: "Not saved" else "Not saved: ${e.message}"
        }
        Toast.makeText(this@CaptureActivity, msg, Toast.LENGTH_LONG).show()
        finish()
      }
    }
    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
      addView(cancel)
      addView(save)
    }
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(pad, pad, pad, pad / 2)
      setBackgroundColor(Color.parseColor("#0F161B"))
      addView(title)
      addView(input, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
      addView(buttons, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
    }
    setContentView(root)
    window.setLayout((resources.displayMetrics.widthPixels * 0.92).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
    input.requestFocus()
  }
}
