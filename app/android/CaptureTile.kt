package ar.nih.mnemostxt

// Quick settings tile "Quick capture": opens the capture box (CaptureActivity)
// from the notification shade; the note lands in the inbox folder. Add it by
// editing the quick settings tiles. On a locked phone it asks to unlock first.

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

class CaptureTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.apply { state = Tile.STATE_INACTIVE; updateTile() }
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { openCapture() } else openCapture()
  }

  private fun openCapture() {
    val i = Intent(this, CaptureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 90_001, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    } else {
      @Suppress("DEPRECATION")
      startActivityAndCollapse(i)
    }
  }
}
