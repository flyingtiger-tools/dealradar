import { getLastAnalysis, getLastError, recordAnalysisError, recordAnalysisSuccess, resetDiagnostics } from "../diagnostics-store";

describe("diagnostics-store", () => {
  beforeEach(() => resetDiagnostics());

  it("aucune analyse encore effectuée : tout est null", () => {
    expect(getLastAnalysis()).toBeNull();
    expect(getLastError()).toBeNull();
  });

  it("succès enregistré : lastAnalysis reflète le succès, lastError reste null", () => {
    recordAnalysisSuccess(1234);
    expect(getLastAnalysis()).toMatchObject({ status: "success", durationMs: 1234 });
    expect(getLastError()).toBeNull();
  });

  it("erreur enregistrée : lastAnalysis ET lastError renseignés, jamais une pile complète (juste code/étape/horodatage)", () => {
    recordAnalysisError("REQUEST_TIMEOUT", "request", 5000);
    expect(getLastAnalysis()).toMatchObject({ status: "error", durationMs: 5000 });
    expect(getLastError()).toMatchObject({ code: "REQUEST_TIMEOUT", stage: "request" });
  });

  it("resetDiagnostics() : repli propre, jamais utilisé automatiquement en production (appelé ici seulement par le test)", () => {
    recordAnalysisSuccess(1);
    resetDiagnostics();
    expect(getLastAnalysis()).toBeNull();
  });
});
