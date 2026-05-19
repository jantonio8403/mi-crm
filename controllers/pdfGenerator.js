const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function generarOficioPDF(documento, ruta, copias = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'LETTER' });
    const stream = fs.createWriteStream(ruta);
    doc.pipe(stream);

    const esMemora = documento.tipo === 'memorandum';

    // ─── Encabezado ───────────────────────────────────────────────
    doc.fontSize(9).font('Helvetica')
      .text('SECRETARÍA DE SALUD DE CHIAPAS', { align: 'center' })
      .text('HOSPITAL BÁSICO COMUNITARIO 12 CAMAS', { align: 'center' })
      .text('BERRIOZABAL, CHIAPAS', { align: 'center' });

    doc.moveDown(0.5);
    doc.moveTo(60, doc.y).lineTo(552, doc.y).stroke();
    doc.moveDown(0.5);

    // ─── Tipo de documento ────────────────────────────────────────
    doc.fontSize(13).font('Helvetica-Bold')
      .text(esMemora ? 'MEMORÁNDUM' : 'OFICIO', { align: 'center' });

    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica')
      .text(`${documento.numero_folio}`, { align: 'center' });

    doc.moveDown(1);

    // ─── Datos del documento ──────────────────────────────────────
    if (esMemora) {
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
    } else {
      // Oficio: fecha arriba a la derecha, destinatario al inicio
      doc.fontSize(10).font('Helvetica')
        .text(`Berriozabal, Chiapas; ${formatearFecha(documento.fecha_emision)}`, { align: 'right' });
      doc.moveDown(0.8);

      doc.font('Helvetica-Bold').text(documento.destinatario);
      if (documento.cargo_destinatario) doc.font('Helvetica').text(documento.cargo_destinatario);
      if (documento.atencion_a) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').text('ATN: ', { continued: true })
          .font('Helvetica').text(documento.atencion_a);
        if (documento.atencion_a_cargo) doc.font('Helvetica').text(documento.atencion_a_cargo);
      }
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('ASUNTO: ', { continued: true })
        .font('Helvetica').text(documento.asunto);
    }

    doc.moveDown(1);
    doc.moveTo(60, doc.y).lineTo(552, doc.y).dash(3, { space: 3 }).stroke().undash();
    doc.moveDown(1);

    // ─── Cuerpo ───────────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica').text(htmlToText(documento.contenido), {
      align: 'justify',
      lineGap: 4,
    });

    doc.moveDown(2);

    // ─── Firma ────────────────────────────────────────────────────
    const firmaX = 300;
    const firmaNombre = documento.firmante_nombre || 'DIRECTOR DEL HOSPITAL';
    const firmaCargo  = documento.firmante_cargo  || '';
    doc.moveTo(firmaX, doc.y).lineTo(firmaX + 200, doc.y).stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica-Bold')
      .text(firmaNombre.toUpperCase(), firmaX, doc.y, { width: 200, align: 'center' });
    if (firmaCargo) {
      doc.font('Helvetica')
        .text(firmaCargo, firmaX, doc.y, { width: 200, align: 'center' });
    }
    doc.font('Helvetica')
      .text('HOSPITAL BÁSICO COMUNITARIO', firmaX, doc.y, { width: 200, align: 'center' })
      .text('12 CAMAS, BERRIOZABAL, CHIS.', firmaX, doc.y, { width: 200, align: 'center' });

    // ─── C.c.p. ───────────────────────────────────────────────────
    if (copias && copias.length > 0) {
      doc.moveDown(1.5);
      doc.fontSize(9).fillColor('black').font('Helvetica-Bold').text('C.c.p.');
      copias.forEach(c => {
        const linea = [c.nombre, c.cargo].filter(Boolean).join(', ');
        doc.font('Helvetica').text('  ' + linea);
      });
    }

    // ─── Pie de página ────────────────────────────────────────────
    doc.fontSize(7).fillColor('gray')
      .text(
        `Documento generado el ${new Date().toLocaleString('es-MX')} — ${documento.numero_folio}`,
        60, 720, { align: 'center', width: 492 }
      );

    doc.end();
    stream.on('finish', () => resolve(ruta));
    stream.on('error', reject);
  });
}

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
  const [anio, mes, dia] = fechaStr.split('-');
  return `${parseInt(dia)} de ${meses[parseInt(mes) - 1]} de ${anio}`;
}

module.exports = { generarOficioPDF };
