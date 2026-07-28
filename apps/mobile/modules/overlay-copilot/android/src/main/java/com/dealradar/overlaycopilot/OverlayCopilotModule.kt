package com.dealradar.overlaycopilot

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.DisplayMetrics
import androidx.localbroadcastmanager.content.LocalBroadcastManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream

class CaptureResult(
  @Field val uri: String,
) : Record

/**
 * Pont Expo Modules <-> overlay/MediaProjection/foreground service (ADR
 * 0010). API Expo Modules (Kotlin `Module`/`ModuleDefinition`), pas
 * l'ancienne API `ReactPackage`/`ReactContextBaseJavaModule` : le
 * changement a été nécessaire pendant la construction du spike —
 * `expo-module.config.json` déclare les classes autolinkées comme des
 * `Module` Expo, l'ancienne API échouait à la compilation
 * (`ExpoModulesPackageList.java` attend `Class<? extends Module>`, voir
 * `docs/mobile/readiness-audit.md`). Chaque méthode a une contrepartie
 * documentée dans `docs/mobile/android-permissions.md`. Règle absolue
 * vérifiée par ce fichier : `requestSingleCapture` est le seul chemin qui
 * mène à `MediaProjectionManager.createScreenCaptureIntent()` — aucun appel
 * automatique, aucune boucle, une capture par appel.
 */
class OverlayCopilotModule : Module() {

  companion object {
    private const val REQUEST_MEDIA_PROJECTION = 9001
  }

  private var pendingCapturePromise: Promise? = null
  private var mediaProjection: MediaProjection? = null
  private var virtualDisplay: VirtualDisplay? = null
  private var imageReader: ImageReader? = null
  private var projectionCallback: MediaProjection.Callback? = null

  private val bubbleTappedReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      sendEvent("OverlayCopilot.bubbleTapped", mapOf<String, Any?>())
    }
  }

  override fun definition() = ModuleDefinition {
    Name("OverlayCopilot")
    Events("OverlayCopilot.bubbleTapped")

    OnCreate {
      appContext.reactContext?.let { context ->
        LocalBroadcastManager.getInstance(context)
          .registerReceiver(bubbleTappedReceiver, IntentFilter(OverlayBubbleService.ACTION_BUBBLE_TAPPED))
      }
    }

    OnDestroy {
      appContext.reactContext?.let { context ->
        LocalBroadcastManager.getInstance(context).unregisterReceiver(bubbleTappedReceiver)
      }
    }

    AsyncFunction("hasOverlayPermission") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)
    }

    AsyncFunction("requestOverlayPermission") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)) {
        return@AsyncFunction true
      }
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
      activity.startActivity(intent)
      // Résolution optimiste : Android ne fournit pas de callback direct pour
      // ce paramètre système — l'appelant JS revérifie via hasOverlayPermission()
      // au retour au premier plan (voir docs/mobile/android-permissions.md, checklist).
      Settings.canDrawOverlays(context)
    }

    AsyncFunction("startBubbleService") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      OverlayBubbleService.start(context)
    }

    AsyncFunction("stopBubbleService") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      OverlayBubbleService.stop(context)
    }

    AsyncFunction("requestSingleCapture") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "Aucune Activity au premier plan pour demander le consentement de capture.", null)
        return@AsyncFunction
      }
      if (pendingCapturePromise != null) {
        promise.reject("CAPTURE_IN_PROGRESS", "Une capture est déjà en cours.", null)
        return@AsyncFunction
      }
      pendingCapturePromise = promise
      val projectionManager =
        activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      activity.startActivityForResult(projectionManager.createScreenCaptureIntent(), REQUEST_MEDIA_PROJECTION)
    }

    AsyncFunction("deleteCapture") { uri: String ->
      val path = Uri.parse(uri).path
      if (path != null) File(path).delete()
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != REQUEST_MEDIA_PROJECTION) return@OnActivityResult
      val promise = pendingCapturePromise
      pendingCapturePromise = null

      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        // Consentement MediaProjection refusé — jamais de repli silencieux, on résout avec `null`.
        promise?.resolve(null)
        return@OnActivityResult
      }

      val context = appContext.reactContext
      if (context == null) {
        promise?.reject(Exceptions.ReactContextLost())
        return@OnActivityResult
      }
      // Promotion en type `mediaProjection` seulement maintenant que le
      // consentement est accordé — jamais avant (voir OverlayBubbleService,
      // bug réel de SecurityException rencontré en testant sur l'émulateur).
      OverlayBubbleService.promoteForCapture(context)
      val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val projection = projectionManager.getMediaProjection(payload.resultCode, payload.data!!)
      mediaProjection = projection
      captureSingleFrame(context, projection, promise)
    }
  }

  /**
   * Une seule frame, puis arrêt immédiat de la projection — jamais un flux
   * continu. `ImageReader` à capacité 2 (recommandation Android pour éviter
   * un blocage producteur/consommateur), on ne consomme que la première image.
   */
  private fun captureSingleFrame(context: Context, projection: MediaProjection, promise: Promise?) {
    val metrics = DisplayMetrics()
    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
    @Suppress("DEPRECATION")
    windowManager.defaultDisplay.getRealMetrics(metrics)
    val width = metrics.widthPixels
    val height = metrics.heightPixels
    val density = metrics.densityDpi

    val reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    imageReader = reader

    // Android 14+ exige l'enregistrement d'un callback avant tout appel à
    // createVirtualDisplay() — sans lui, IllegalStateException("Must register
    // a callback before starting capture") — bug réel rencontré en testant
    // sur l'émulateur, voir docs/mobile/readiness-audit.md. Aucune action
    // requise dans onStop() : la capture est déjà ponctuelle et se termine
    // dans le finally ci-dessous, ce callback ne fait que satisfaire l'API.
    val callback = object : MediaProjection.Callback() {
      override fun onStop() {
        virtualDisplay?.release()
        imageReader?.close()
      }
    }
    projectionCallback = callback
    projection.registerCallback(callback, Handler(Looper.getMainLooper()))

    val display = projection.createVirtualDisplay(
      "DealRadarCopilotCapture",
      width,
      height,
      density,
      DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
      reader.surface,
      null,
      null,
    )
    virtualDisplay = display

    reader.setOnImageAvailableListener({ availableReader ->
      // Nom distinct de la propriété `imageReader` de la classe : un nom
      // identique masquerait la propriété (elle n'est alors plus
      // réassignable dans ce bloc — bug réel rencontré à la compilation).
      val image = availableReader.acquireLatestImage() ?: return@setOnImageAvailableListener
      try {
        val uri = saveImageToCache(context, image, width, height)
        promise?.resolve(CaptureResult(uri))
      } catch (error: Exception) {
        promise?.reject(CodedException("CAPTURE_FAILED", error.message ?: "Échec de capture", error))
      } finally {
        image.close()
        // Ponctuel : la projection s'arrête dès la première frame consommée.
        display?.release()
        reader.close()
        projectionCallback?.let { projection.unregisterCallback(it) }
        projection.stop()
        virtualDisplay = null
        imageReader = null
        mediaProjection = null
        projectionCallback = null
        // Ne reste jamais en type `mediaProjection` au-delà de la capture ponctuelle.
        OverlayBubbleService.demoteAfterCapture(context)
      }
    }, null)
  }

  private fun saveImageToCache(context: Context, image: android.media.Image, width: Int, height: Int): String {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val pixelStride = plane.pixelStride
    val rowStride = plane.rowStride
    val rowPadding = rowStride - pixelStride * width

    val bitmap = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888)
    bitmap.copyPixelsFromBuffer(buffer)
    val cropped = Bitmap.createBitmap(bitmap, 0, 0, width, height)

    val file = File(context.cacheDir, "copilot-capture-${System.currentTimeMillis()}.png")
    FileOutputStream(file).use { output -> cropped.compress(Bitmap.CompressFormat.PNG, 100, output) }
    bitmap.recycle()
    cropped.recycle()
    return Uri.fromFile(file).toString()
  }
}
