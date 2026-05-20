const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generarOficioPDF(documento, ruta, copias = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
    const stream = fs.createWriteStream(ruta);
    doc.pipe(stream);

    if (documento.tipo === 'memorandum') {
      generarMemorandum(doc, documento, copias);
    } else {
      generarOficio(doc, documento, copias);
    }

    doc.end();
    stream.on('finish', () => resolve(ruta));
    stream.on('error', reject);
  });
}

// ════════════════════════════════════════════════════════════════
//  OFICIO
// ════════════════════════════════════════════════════════════════
function generarOficio(doc, documento, copias) {

  // ── Encabezado institucional ─────────────────────────────────
  doc.fontSize(8).font('Helvetica-Bold')
    .text('IMSS-BIENESTAR / SERVICIOS PÚBLICOS DE SALUD', { align: 'center' });
  doc.fontSize(8).font('Helvetica')
    .text('HOSPITAL BÁSICO COMUNITARIO 12 CAMAS, BERRIOZÁBAL, CHIAPAS', { align: 'center' });
  doc.moveDown(0.4);
  doc.moveTo(60, doc.y).lineTo(552, doc.y).stroke();
  doc.moveDown(0.8);

  // ── Bloque derecho: folio / fecha / asunto ───────────────────
  doc.fontSize(10).font('Helvetica-Bold')
    .text(`Oficio Número: ${documento.numero_folio}.`, { align: 'right' });
  doc.font('Helvetica')
    .text(`Berriozábal, Chiapas a ${formatearFecha(documento.fecha_emision)}.`, { align: 'right' });
  doc.font('Helvetica-Bold')
    .text(`Asunto: ${documento.asunto}.`, { align: 'right' });

  doc.moveDown(1.4);

  // ── Destinatario (izquierda, negritas, mayúsculas) ───────────
  doc.fontSize(10).font('Helvetica-Bold')
    .text(documento.destinatario.toUpperCase(), { width: 370 });
  if (documento.cargo_destinatario) {
    doc.text(documento.cargo_destinatario.toUpperCase(), { width: 370 });
  }

  // Con atención a (opcional)
  if (documento.atencion_a) {
    doc.moveDown(0.4);
    doc.text(documento.atencion_a.toUpperCase(), { width: 370 });
    if (documento.atencion_a_cargo) {
      doc.text(documento.atencion_a_cargo.toUpperCase(), { width: 370 });
    }
  }

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('PRESENTE.', { width: 370 });
  doc.moveDown(1.2);

  // ── Cuerpo ───────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica').text(htmlToText(documento.contenido), {
    align: 'justify',
    lineGap: 3,
    width: 492,
  });

  doc.moveDown(2.5);

  // ── Firmante (negritas, mayúsculas, sin línea) ────────────────
  const firmaNombre = documento.firmante_nombre || '';
  const firmaCargo  = documento.firmante_cargo  || '';
  if (firmaNombre) {
    doc.fontSize(10).font('Helvetica-Bold')
      .text(firmaNombre.toUpperCase(), { width: 492 });
  }
  if (firmaCargo) {
    doc.font('Helvetica-Bold')
      .text(firmaCargo.toUpperCase(), { width: 492 });
  }

  doc.moveDown(1.2);

  // ── C.c.p. ───────────────────────────────────────────────────
  if (copias && copias.length > 0) {
    copias.forEach(c => {
      const linea = 'C.c.p. ' + c.nombre + (c.cargo ? '.- ' + c.cargo + '.' : '.');
      doc.fontSize(8).font('Helvetica').fillColor('black').text(linea, { width: 492 });
    });
    doc.moveDown(0.3);
  }

  // ── Vo. Bo. ──────────────────────────────────────────────────
  if (documento.vobo_nombre) {
    const linea = 'Vo. Bo. ' + documento.vobo_nombre +
      (documento.vobo_cargo ? '.- ' + documento.vobo_cargo + '.' : '.');
    doc.fontSize(8).font('Helvetica').text(linea, { width: 492 });
    doc.moveDown(0.3);
  }

  // ── Elaboró ──────────────────────────────────────────────────
  if (documento.elaboro_nombre) {
    const linea = 'Elaboró: ' + documento.elaboro_nombre +
      (documento.elaboro_cargo ? '.- ' + documento.elaboro_cargo + '.' : '.');
    doc.fontSize(8).font('Helvetica').text(linea, { width: 492 });
  }

  // ── Pie de página ─────────────────────────────────────────────
  doc.fontSize(7).fillColor('gray')
    .text(
      'Gustavo E. Campa No. 54, Col. Guadalupe Inn, C.P. 01020, Alcaldía Álvaro Obregón, CDMX. (Tel: 55) 9160 8100 imssbienestar.gob.mx',
      60, 728, { align: 'center', width: 492 }
    );
}

// ════════════════════════════════════════════════════════════════
//  MEMORÁNDUM
// ════════════════════════════════════════════════════════════════
function generarMemorandum(doc, documento, copias) {

  // ── Encabezado ───────────────────────────────────────────────
  doc.fontSize(8).font('Helvetica-Bold')
    .text('IMSS-BIENESTAR / SERVICIOS PÚBLICOS DE SALUD', { align: 'center' });
  doc.fontSize(8).font('Helvetica')
    .text('HOSPITAL BÁSICO COMUNITARIO 12 CAMAS, BERRIOZÁBAL, CHIAPAS', { align: 'center' });
  doc.moveDown(0.4);
  doc.moveTo(60, doc.y).lineTo(552, doc.y).stroke();
  doc.moveDown(0.8);

  doc.fontSize(13).font('Helvetica-Bold')
    .text('MEMORÁNDUM', { align: 'center' });
  doc.fontSize(10).font('Helvetica')
    .text(documento.numero_folio, { align: 'center' });
  doc.moveDown(1);

  // ── Encabezado interno ───────────────────────────────────────
  doc.fontSize(10).font('Helvetica-Bold').text('PARA: ', { continued: true })
    .font('Helvetica').text(documento.destinatario);
  if (documento.cargo_destinatario) {
    doc.font('Helvetica-Bold').text('CARGO: ', { continued: true })
      .font('Helvetica').text(documento.cargo_destinatario);
  }
  doc.font('Helvetica-Bold').text('ASUNTO: ', { continued: true })
    .font('Helvetica').text(documento.asunto);
  doc.font('Helvetica-Bold').text('FECHA: ', { continued: true })
    .font('Helvetica').text(formatearFecha(documento.fecha_emision));

  doc.moveDown(1);
  doc.moveTo(60, doc.y).lineTo(552, doc.y).dash(3, { space: 3 }).stroke().undash();
  doc.moveDown(1);

  // ── Cuerpo ───────────────────────────────────────────────────
  doc.fontSize(10).font('Helvetica').text(htmlToText(documento.contenido), {
    align: 'justify',
    lineGap: 3,
    width: 492,
  });

  doc.moveDown(2.5);

  // ── Firmante ─────────────────────────────────────────────────
  const firmaNombre = documento.firmante_nombre || '';
  const firmaCargo  = documento.firmante_cargo  || '';
  if (firmaNombre) {
    doc.fontSize(10).font('Helvetica-Bold')
      .text(firmaNombre.toUpperCase(), { width: 492 });
  }
  if (firmaCargo) {
    doc.font('Helvetica-Bold').text(firmaCargo.toUpperCase(), { width: 492 });
  }

  doc.moveDown(1.2);

  // ── Vo. Bo. ──────────────────────────────────────────────────
  if (documento.vobo_nombre) {
    const linea = 'Vo. Bo. ' + documento.vobo_nombre +
      (documento.vobo_cargo ? '.- ' + documento.vobo_cargo + '.' : '.');
    doc.fontSize(8).font('Helvetica').text(linea, { width: 492 });
    doc.moveDown(0.3);
  }

  // ── Elaboró ──────────────────────────────────────────────────
  if (documento.elaboro_nombre) {
    const linea = 'Elaboró: ' + documento.elaboro_nombre +
      (documento.elaboro_cargo ? '.- ' + documento.elaboro_cargo + '.' : '.');
    doc.fontSize(8).font('Helvetica').text(linea, { width: 492 });
  }

  // ── Pie de página ─────────────────────────────────────────────
  doc.fontSize(7).fillColor('gray')
    .text(
      'Gustavo E. Campa No. 54, Col. Guadalupe Inn, C.P. 01020, Alcaldía Álvaro Obregón, CDMX. (Tel: 55) 9160 8100 imssbienestar.gob.mx',
      60, 728, { align: 'center', width: 492 }
    );
}

// ════════════════════════════════════════════════════════════════
//  UTILIDADES
// ════════════════════════════════════════════════════════════════
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/table>/gi, '\n')
    .replace(/<p[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  • ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatearFecha(fechaStr) {
  if (!fechaStr) return '';
  const meses = ['enero','febrero','marzo','abril','mayo','junio',
                  'julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const s = fechaStr instanceof Date
    ? fechaStr.toISOString().split('T')[0]
    : String(fechaStr);
  const [anio, mes, dia] = s.split('-');
  return `${parseInt(dia)} de ${meses[parseInt(mes) - 1]} de ${anio}`;
}

module.exports = { generarOficioPDF };
