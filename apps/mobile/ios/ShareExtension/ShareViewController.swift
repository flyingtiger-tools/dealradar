import UIKit
import MobileCoreServices
import UniformTypeIdentifiers

/// Cible Share Extension iOS (ADR 0010, docs/mobile/ios-share-extension.md).
///
/// NON COMPILÉ, NON EXÉCUTÉ DANS CE LOT — aucun Xcode/macOS disponible sur
/// cette machine de développement (Windows). Ce fichier documente la
/// conception voulue et doit être vérifié sur macOS avant d'être considéré
/// fonctionnel — voir le plan de test dans le document ci-dessus.
///
/// Règle vérifiée par la conception : cette extension ne lit JAMAIS l'état
/// de l'application source. Elle ne reçoit que ce qu'iOS lui remet via
/// `extensionContext.inputItems`, c'est-à-dire exactement ce que
/// l'utilisateur a choisi de partager — aucune API iOS store-compliant ne
/// permet davantage.
final class ShareViewController: UIViewController {
  private let appGroupIdentifier = "group.com.dealradar.mobile"
  private let maxContentBytes = 20 * 1024 * 1024

  override func viewDidLoad() {
    super.viewDidLoad()
    handleSharedContent()
  }

  private func handleSharedContent() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem], !items.isEmpty else {
      completeAndReturn()
      return
    }

    // Un seul item traité : "une annonce à la fois" (voir Info.plist,
    // NSExtensionActivationSupportsWebURLWithMaxCount=1 etc.) — jamais un
    // partage multiple mélangeant plusieurs objets.
    guard let attachment = items.first?.attachments?.first else {
      completeAndReturn()
      return
    }

    if attachment.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      attachment.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
        guard let url = data as? URL else { self?.completeAndReturn(); return }
        self?.persistPendingRequest(sharedUrl: url.absoluteString, imageData: nil)
      }
    } else if attachment.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      attachment.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] data, _ in
        guard let self = self else { return }
        let imageData: Data?
        switch data {
        case let url as URL:
          imageData = try? Data(contentsOf: url)
        case let image as UIImage:
          imageData = image.pngData()
        default:
          imageData = nil
        }
        self.persistPendingRequest(sharedUrl: nil, imageData: imageData)
      }
    } else if attachment.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      attachment.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
        let text = data as? String
        self?.persistPendingRequest(sharedUrl: nil, imageData: nil, sharedText: text)
      }
    } else {
      completeAndReturn()
    }
  }

  /// Écrit dans le conteneur App Group partagé plutôt que d'appeler
  /// directement /v1/analyses ici : l'extension a un budget mémoire/temps
  /// strict imposé par iOS, l'app principale (déjà connectée, déjà
  /// authentifiée) est le lieu le plus fiable pour l'appel réseau réel et
  /// le polling du résultat.
  private func persistPendingRequest(sharedUrl: String?, imageData: Data?, sharedText: String? = nil) {
    guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
      completeAndReturn()
      return
    }

    var payload: [String: Any] = [
      "sourceType": "ios_share_extension",
      "sharedUrl": sharedUrl as Any,
      "description": sharedText as Any,
      "receivedAt": ISO8601DateFormatter().string(from: Date()),
    ]

    if let imageData = imageData, imageData.count <= maxContentBytes {
      let filename = "pending-share-\(UUID().uuidString).png"
      if let containerUrl = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) {
        let fileUrl = containerUrl.appendingPathComponent(filename)
        try? imageData.write(to: fileUrl)
        payload["pendingImageFilename"] = filename
      }
    }

    defaults.set(payload, forKey: "pendingAnalysisRequest")
    completeAndReturn()
  }

  private func completeAndReturn() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
