package com.dealradar.overlaycopilot

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import androidx.core.app.NotificationCompat
import androidx.localbroadcastmanager.content.LocalBroadcastManager

/**
 * Bulle flottante + service de premier plan (ADR 0010,
 * docs/mobile/android-permissions.md). Règle absolue vérifiée ici : ce
 * service n'émet JAMAIS `ACTION_BUBBLE_TAPPED` en dehors du gestionnaire de
 * clic de la bulle — aucune boucle, aucun minuteur, aucune lecture d'écran
 * en continu. Le module (`OverlayCopilotModule`) écoute ce broadcast et le
 * retransmet en événement JS ; la capture elle-même est déclenchée côté JS
 * (donc côté Activity, seul endroit où `MediaProjectionManager` peut
 * demander le consentement), jamais par ce service.
 */
class OverlayBubbleService : Service() {

  companion object {
    const val ACTION_BUBBLE_TAPPED = "com.dealradar.overlaycopilot.BUBBLE_TAPPED"
    private const val ACTION_STOP = "com.dealradar.overlaycopilot.STOP"
    private const val NOTIFICATION_CHANNEL_ID = "overlay_copilot_active"
    private const val NOTIFICATION_ID = 4242

    /**
     * Android 14+ refuse de démarrer (ou de conserver) un service de premier
     * plan de type `mediaProjection` tant que l'AppOp `project_media`
     * correspondant n'existe pas — lui-même créé seulement une fois le
     * consentement `MediaProjection` accordé par l'utilisateur. Déclarer ce
     * type dès l'activation de la bulle (avant tout consentement) fait
     * planter `startForeground()` avec un `SecurityException` — bug réel
     * rencontré en testant sur l'émulateur, voir
     * docs/mobile/readiness-audit.md. La bulle démarre donc en type
     * `specialUse` (aucune précondition), et n'est promue en `mediaProjection`
     * que juste avant `getMediaProjection()`, une fois le consentement
     * effectivement accordé — jamais avant.
     *
     * Référence à l'instance en cours d'exécution — `null` si le service
     * n'est pas actif. `startForegroundService()` est **asynchrone** (il ne
     * fait que poster l'intent, sans attendre que `onStartCommand` ait
     * réellement tourné) : appeler `getMediaProjection()` juste après un
     * `startForegroundService(ACTION_PROMOTE_FOR_CAPTURE)` déclenchait un
     * `SecurityException` (« Media projections require a foreground service
     * of type ... ») parce que la promotion n'avait pas encore eu lieu au
     * moment de l'appel — bug réel rencontré en testant sur l'émulateur, voir
     * docs/mobile/readiness-audit.md. `promoteForCapture()`/`demoteAfterCapture()`
     * appellent donc directement la méthode d'instance, synchrone, plutôt que
     * de repasser par un Intent.
     */
    @Volatile private var instance: OverlayBubbleService? = null

    fun start(context: Context) {
      val intent = Intent(context, OverlayBubbleService::class.java)
      context.startForegroundService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, OverlayBubbleService::class.java))
    }

    /** Appelé juste après l'obtention du consentement MediaProjection, jamais avant. */
    fun promoteForCapture(context: Context) {
      instance?.startForegroundWithNotification(includeMediaProjectionType = true)
    }

    /** Appelé dès la fin de la capture ponctuelle — ne reste jamais en type `mediaProjection` au-delà. */
    fun demoteAfterCapture(context: Context) {
      instance?.startForegroundWithNotification(includeMediaProjectionType = false)
    }
  }

  private var windowManager: WindowManager? = null
  private var bubbleView: View? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    startForegroundWithNotification(includeMediaProjectionType = false)
    addBubble()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    removeBubble()
    super.onDestroy()
  }

  /**
   * Notification permanente obligatoire tant que le service tourne — c'est
   * l'indicateur visible exigé par la règle produit ("aucune surveillance
   * silencieuse"), jamais optionnel.
   */
  private fun startForegroundWithNotification(includeMediaProjectionType: Boolean) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        NOTIFICATION_CHANNEL_ID,
        "Copilote DealRadar actif",
        NotificationManager.IMPORTANCE_LOW,
      )
      manager.createNotificationChannel(channel)
    }

    val stopIntent = Intent(this, OverlayBubbleService::class.java).setAction(ACTION_STOP)
    val stopPendingIntent = PendingIntent.getService(this, 0, stopIntent, PendingIntent.FLAG_IMMUTABLE)

    val notification: Notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
      .setContentTitle("Copilote DealRadar actif")
      .setContentText("Appuyez sur la bulle pour analyser une annonce. Appuyez ici pour désactiver.")
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setOngoing(true)
      .setContentIntent(stopPendingIntent)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val type = if (includeMediaProjectionType) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      } else {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      }
      startForeground(NOTIFICATION_ID, notification, type)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun addBubble() {
    val manager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = manager

    val overlayType =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      overlayType,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
      PixelFormat.TRANSLUCENT,
    )
    params.gravity = Gravity.TOP or Gravity.START
    params.x = 0
    params.y = 200

    val bubble = Button(this).apply { text = "DR" }

    // En-dessous de ce déplacement cumulé (px), un relâchement est traité
    // comme un tap plutôt qu'un glissement. `ViewConfiguration` fournit le
    // seuil standard Android plutôt qu'une valeur arbitraire.
    val touchSlop = android.view.ViewConfiguration.get(this).scaledTouchSlop
    var initialX = 0
    var initialY = 0
    var initialTouchX = 0f
    var initialTouchY = 0f
    var totalMovement = 0f
    bubble.setOnTouchListener { view, event ->
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          initialX = params.x
          initialY = params.y
          initialTouchX = event.rawX
          initialTouchY = event.rawY
          totalMovement = 0f
          // Renvoyer `true` est indispensable : sans cela, ce même listener
          // ne reçoit jamais les événements MOVE/UP de ce geste (Android ne
          // délivre la suite d'un geste qu'au récepteur qui a « réclamé » le
          // DOWN) — bug réel rencontré en testant le déplacement de la
          // bulle sur l'émulateur, corrigé ici. Voir
          // docs/mobile/readiness-audit.md.
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - initialTouchX
          val dy = event.rawY - initialTouchY
          totalMovement = kotlin.math.hypot(dx, dy)
          params.x = initialX + dx.toInt()
          params.y = initialY + dy.toInt()
          windowManager?.updateViewLayout(view, params)
          true
        }
        MotionEvent.ACTION_UP -> {
          if (totalMovement < touchSlop) {
            // Seul point d'émission de ACTION_BUBBLE_TAPPED dans tout le
            // service — vérifiable par lecture, pas seulement par test.
            LocalBroadcastManager.getInstance(this@OverlayBubbleService)
              .sendBroadcast(Intent(ACTION_BUBBLE_TAPPED))
          }
          true
        }
        else -> false
      }
    }

    bubbleView = bubble
    manager.addView(bubble, params)
  }

  private fun removeBubble() {
    bubbleView?.let { windowManager?.removeView(it) }
    bubbleView = null
  }
}
