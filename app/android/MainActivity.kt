package ar.nih.mnemostxt

// mnemostxt's Android activity (copied over Tauri's generated one by
// scripts/android-prepare.py).
//  - Asks for "All files access" so the notes folder can live in shared
//    storage (e.g. /storage/emulated/0/notes, synced by Syncthing).
//  - Pads the web view by the system bars and the keyboard, so nothing hides
//    under them (Android 15 always draws edge to edge).
//  - Gives the web page a small bridge, window.MnemostxtAndroid
//    (frontend/src/backend/android.js): the system folder picker, the lock,
//    the permission screens, and the settings ShareActivity needs.
//  - Opens the file a widget was tapped on (Widgets.kt): the request waits in a
//    queue until the page takes it (MnemostxtAndroid.takeOpenRequests).
//  - Locks with the phone's own lock (fingerprint, face, PIN, pattern) when
//    Preferences → This device → Lock is on: at start, and after the app was
//    in the background for the chosen number of minutes. mnemostxt stores no
//    PIN of its own.

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.provider.DocumentsContract
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var lockCover: View? = null
  private var authenticating = false
  private var backgroundSince = 0L // elapsedRealtime when the app went to the background
  private var skipNextLock = false // returning from our own picker or settings screen

  private val prefs by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val root = findViewById<View>(android.R.id.content)
    root.setBackgroundColor(Color.parseColor("#070B0F"))
    WindowCompat.getInsetsController(window, root).isAppearanceLightStatusBars = false
    ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
    if (lockEnabled()) lock()
    queueOpen(intent)
    askForFileAccess()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    queueOpen(intent)
  }

  // ── files opened from a widget ────────────────────────────────────────────

  private fun queueOpen(intent: Intent?) {
    if (intent?.action != Widgets.ACTION_OPEN) return
    val path = intent.getStringExtra(Widgets.EXTRA_PATH) ?: return
    synchronized(openQueue) { openQueue.add(path) }
    intent.removeExtra(Widgets.EXTRA_PATH) // not again on rotation
    runOnUiThread { webView?.evaluateJavascript("window.__mnemostxtOpenPending && window.__mnemostxtOpenPending()", null) }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(Bridge(), "MnemostxtAndroid")
  }

  // ── lock ──────────────────────────────────────────────────────────────────

  private fun lockEnabled() = prefs.getBoolean("lock", false)

  override fun onStop() {
    super.onStop()
    Widgets.updateAll(this) // the widgets show what changed while the app was open
    if (!authenticating && !skipNextLock && lockCover == null) backgroundSince = SystemClock.elapsedRealtime()
  }

  override fun onStart() {
    super.onStart()
    if (skipNextLock) { skipNextLock = false; backgroundSince = 0L; return }
    if (!lockEnabled() || backgroundSince == 0L || lockCover != null) return
    val after = prefs.getInt("lockAfterMinutes", 1).coerceAtLeast(0) * 60_000L
    if (SystemClock.elapsedRealtime() - backgroundSince >= after) lock()
    backgroundSince = 0L
  }

  /** Covers the app and asks for the phone's lock. */
  private fun lock() {
    if (lockCover == null) {
      val label = TextView(this).apply {
        text = "MnemoTXT is locked"
        setTextColor(Color.parseColor("#E6ECEC"))
        textSize = 18f
        gravity = Gravity.CENTER
      }
      val button = Button(this).apply { text = "Unlock"; setOnClickListener { authenticate() } }
      val column = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        addView(label)
        addView(button)
      }
      val cover = FrameLayout(this).apply {
        setBackgroundColor(Color.parseColor("#070B0F"))
        isClickable = true // nothing behind it can be touched
        addView(column, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
      }
      addContentView(cover, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
      lockCover = cover
    }
    window.decorView.post { authenticate() }
  }

  private fun unlock() {
    (lockCover?.parent as? ViewGroup)?.removeView(lockCover)
    lockCover = null
  }

  private val authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL

  private fun canLock(): Boolean {
    val ok = BiometricManager.from(this).canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    return ok || (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
  }

  private fun authenticate() {
    if (authenticating || lockCover == null) return
    if (!canLock()) { unlock(); return } // the phone has no lock any more: nothing to ask for
    authenticating = true
    val prompt = BiometricPrompt(this, ContextCompat.getMainExecutor(this), object : BiometricPrompt.AuthenticationCallback() {
      override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
        authenticating = false
        unlock()
      }
      override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
        authenticating = false // the cover stays; its Unlock button tries again
      }
    })
    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Unlock MnemoTXT")
      .setAllowedAuthenticators(authenticators)
      .build()
    prompt.authenticate(info)
  }

  // ── storage permission ────────────────────────────────────────────────────

  private fun hasFileAccess(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)
      .all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

  private fun askForFileAccess() {
    if (hasFileAccess()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) openAllFilesScreen()
    else requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
  }

  private fun openAllFilesScreen() {
    skipNextLock = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      try {
        startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
      } catch (e: Exception) {
        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
      }
    } else {
      openAppScreen()
    }
  }

  private fun openAppScreen() {
    skipNextLock = true
    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
  }

  // ── folder picker ─────────────────────────────────────────────────────────

  /** The system folder picker; answers the page with a real path or null. */
  private fun launchFolderPicker(callId: Int) {
    skipNextLock = true
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
    launchActivityForResult(intent) { result ->
      val uri = if (result?.resultCode == Activity.RESULT_OK) result.data?.data else null
      answer(callId, uri?.let { treeToPath(it) })
    }
  }

  private fun answer(callId: Int, value: String?) {
    val js = "window.__mnemostxtCb && window.__mnemostxtCb($callId, ${if (value == null) "null" else JSONObject.quote(value)})"
    runOnUiThread { webView?.evaluateJavascript(js, null) }
  }

  // ── the bridge (window.MnemostxtAndroid) ──────────────────────────────────
  // Runs on a binder thread: anything touching views goes through runOnUiThread.

  inner class Bridge {
    @JavascriptInterface
    fun deviceModel(): String {
      val name = try { Settings.Global.getString(contentResolver, Settings.Global.DEVICE_NAME) } catch (e: Exception) { null }
      return if (!name.isNullOrBlank()) name else Build.MODEL ?: "android"
    }

    @JavascriptInterface
    fun hasAllFilesAccess(): Boolean = hasFileAccess()

    @JavascriptInterface
    fun openAllFilesSettings() = runOnUiThread { openAllFilesScreen() }

    @JavascriptInterface
    fun openAppSettings() = runOnUiThread { openAppScreen() }

    @JavascriptInterface
    fun lockAvailable(): Boolean = canLock()

    @JavascriptInterface
    fun pickFolder(callId: Int) = runOnUiThread { launchFolderPicker(callId) }

    /** Files (or "mnemostxt:new") a widget asked to open, as a JSON array; empties the queue. */
    @JavascriptInterface
    fun takeOpenRequests(): String = synchronized(openQueue) {
      val out = org.json.JSONArray(openQueue).toString()
      openQueue.clear()
      out
    }

    @JavascriptInterface
    fun refreshWidgets() = Widgets.updateAll(this@MainActivity)

    /** Notes folder, inbox and lock settings, kept for ShareActivity and for locking before the page loads. */
    @JavascriptInterface
    fun configure(json: String) {
      val o = JSONObject(json)
      prefs.edit()
        .putString("notesDir", o.optString("notesDir", "").ifBlank { null })
        .putString("inbox", o.optString("inbox", "inbox"))
        .putString("appDir", o.optString("appDir", "logs/mnemostxt"))
        .putBoolean("lock", o.optBoolean("lock", false))
        .putInt("lockAfterMinutes", o.optInt("lockAfterMinutes", 1))
        .apply()
    }
  }

  companion object {
    const val PREFS = "mnemostxt"
    private val openQueue = ArrayList<String>()

    /**
     * content://…/tree/primary%3Anotes → /storage/emulated/0/notes.
     * SD cards: "1234-ABCD:dir" → /storage/1234-ABCD/dir. The app has
     * "All files access", so real paths work everywhere.
     */
    fun treeToPath(uri: Uri): String? {
      val id = try { DocumentsContract.getTreeDocumentId(uri) } catch (e: Exception) { return null }
      if (id.startsWith("raw:")) return id.removePrefix("raw:")
      val volume = id.substringBefore(':')
      val rest = id.substringAfter(':', "")
      val base = when (volume) {
        "primary" -> Environment.getExternalStorageDirectory().absolutePath
        "home" -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath
        else -> "/storage/$volume"
      }
      return if (rest.isEmpty()) base else "$base/$rest"
    }
  }
}
