const PDFDocument = require('pdfkit');

const SEVERITY_COLOR = {
  CRITICAL: '#991b1b',
  HIGH: '#dc2626',
  MEDIUM: '#d97706',
  LOW: '#2563eb',
  INFO: '#6b7280',
};

function addHeading(doc, text, size = 16) {
  doc.moveDown(0.5).fontSize(size).fillColor('#111827').font('Helvetica-Bold').text(text);
  doc.font('Helvetica').fillColor('#000000');
}

function addLabelValue(doc, label, value) {
  doc.fontSize(10).fillColor('#374151').font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').fillColor('#111827').text(String(value));
}

// Streams a PDF diagnosis report directly to the given writable stream (an
// Express response). Uses only data already present on the diagnosis/project
// documents — never re-fetches or invents content, and never includes raw
// file contents or anything from analysisSnapshot.possibleSecrets locations
// (which could echo path-only secret hints — omitted deliberately below).
function generateDiagnosisPdf({ project, diagnosis }, outputStream) {
  const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
  doc.pipe(outputStream);

  // --- Header ---
  doc.fontSize(22).font('Helvetica-Bold').fillColor('#111827').text('Project Doctor AI — Diagnosis Report');
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text(`Generated ${new Date().toLocaleString()}`);

  // --- Project info ---
  addHeading(doc, 'Project');
  addLabelValue(doc, 'Name', project.name);
  if (project.description) addLabelValue(doc, 'Description', project.description);
  addLabelValue(doc, 'Source', project.sourceType);
  if (project.repoUrl) addLabelValue(doc, 'Repository', project.repoUrl);
  addLabelValue(doc, 'Files analyzed', project.files?.length ?? 'n/a');
  addLabelValue(doc, 'Report generated', new Date(diagnosis.createdAt).toLocaleString());

  // --- Overall score ---
  addHeading(doc, 'Overall Health Score');
  doc
    .fontSize(36)
    .font('Helvetica-Bold')
    .fillColor(diagnosis.healthScore >= 80 ? '#16a34a' : diagnosis.healthScore >= 50 ? '#d97706' : '#dc2626')
    .text(`${diagnosis.healthScore} / 100`);
  doc.font('Helvetica').fillColor('#000000');

  // --- Dimension scores ---
  addHeading(doc, 'Dimension Scores');
  const dims = diagnosis.dimensionScores || {};
  for (const [dimName, dim] of Object.entries(dims)) {
    if (!dim) continue;
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica-Bold').text(`${capitalize(dimName)}: ${dim.score}/100`);
    doc.fontSize(9).font('Helvetica').fillColor('#374151');
    (dim.reasons || []).forEach((reason) => doc.text(`• ${reason}`, { indent: 10 }));
    doc.fillColor('#000000');
  }

  // --- Findings ---
  addHeading(doc, `Findings (${(diagnosis.findings || []).length})`);
  if (!diagnosis.findings || diagnosis.findings.length === 0) {
    doc.fontSize(10).text('No specific findings were reported.');
  } else {
    for (const finding of diagnosis.findings) {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(0.5);
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(SEVERITY_COLOR[finding.severity] || '#000000')
        .text(`[${finding.severity}] [${finding.category}] ${finding.title}`);
      doc.font('Helvetica').fillColor('#000000').fontSize(9);
      if (finding.file) doc.text(`File: ${finding.file}`);
      if (finding.description) doc.text(`Description: ${finding.description}`);
      if (finding.evidence) doc.text(`Evidence: ${finding.evidence}`);
      if (finding.reasoning) doc.text(`Reasoning: ${finding.reasoning}`);
      if (finding.recommendation) doc.text(`Recommendation: ${finding.recommendation}`);
      if (finding.estimatedImpact) doc.text(`Estimated impact: ${finding.estimatedImpact}`);
    }
  }

  // --- Action plan ---
  doc.addPage();
  addHeading(doc, 'Priority Action Plan');
  const plan = diagnosis.actionPlan || {};
  for (const priority of ['P0', 'P1', 'P2', 'P3']) {
    const items = plan[priority] || [];
    if (items.length === 0) continue;
    doc.moveDown(0.4).fontSize(13).font('Helvetica-Bold').text(`${priority} (${items.length})`);
    doc.font('Helvetica').fontSize(9);
    for (const item of items) {
      doc.moveDown(0.2).text(`• [${item.category}] ${item.title}${item.file ? ` (${item.file})` : ''}`);
      doc.text(`   Recommendation: ${item.recommendation}`, { indent: 10 });
    }
  }

  doc.end();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { generateDiagnosisPdf };
