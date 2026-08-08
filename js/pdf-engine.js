/**
 * pdf-engine.js - v13.1
 * Fix crítico: firma autógrafa en acta constitutiva y cédulas ahora siempre se renderiza,
 * tanto en PDF inmediato (base64) como en regeneración posterior desde el servidor (URL).
 * Usa loadImageSafe() que ya maneja ambos casos igual que lo hace con las fotos INE.
 */

// ======================================================
// 1. UTILIDADES DE IMAGEN (ANTI-BLOQUEO)
// ======================================================

async function loadImageSafe(src) {
    if (!src) return null;
    if (src.startsWith('data:image')) return src;
    try {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = src;
        await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL("image/jpeg", 0.9);
    } catch (e) {
        console.warn("Imagen no accesible:", src);
        return null;
    }
}

function getLogoData(elementId) {
    try {
        const img = document.getElementById(elementId);
        if (!img || !img.complete || img.naturalWidth === 0) return null;
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png');
    } catch (e) { return null; }
}

const ESTADOS_MX_PDF = [
    "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
    "Ciudad de Mexico", "Coahuila", "Colima", "Durango", "Estado de Mexico", "Guanajuato",
    "Guerrero", "Hidalgo", "Jalisco", "Michoacan", "Morelos", "Nayarit", "Nuevo Leon", "Oaxaca",
    "Puebla", "Queretaro", "Quintana Roo", "San Luis Potosi", "Sinaloa", "Sonora", "Tabasco",
    "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatan", "Zacatecas"
];

// ======================================================
// 2. GENERADOR DE CREDENCIALES (IMAGEN PNG)
// ======================================================
window.generateCredentialImage = async function(data) {
    const domName = document.getElementById('cred-name');
    const cardElement = document.getElementById('credential-card');

    if (!domName || !cardElement) { alert("Error: Plantilla no encontrada."); return; }

    document.getElementById('cred-name').textContent = (data.nombre || "").toUpperCase();
    const rolText = (data.rol || "INTEGRANTE").toUpperCase().replace(/_/g, ' ');
    const roleEl  = document.getElementById('cred-role');
    roleEl.textContent = rolText;

    // Visual especial para Coordinador de Círculo
    const isCoord  = rolText.includes('COORDINADOR');
    const banner   = document.getElementById('cred-coordinador-banner');
    if (isCoord) {
        roleEl.style.color     = '#ff7e00';
        roleEl.style.fontWeight = 'bold';
        if (banner) banner.style.display = 'block';
    } else {
        roleEl.style.color     = '';
        roleEl.style.fontWeight = '';
        if (banner) banner.style.display = 'none';
    }
    document.getElementById('cred-state').textContent = (data.estado || "").toUpperCase();
    document.getElementById('cred-mun').textContent = (data.municipio || "ESTATAL").toUpperCase();
    document.getElementById('cred-circle').textContent = (data.circulo || "ESTRUCTURA DIRECTIVA").toUpperCase();
    document.getElementById('cred-date').textContent = new Date().getFullYear();
    const cleanId = data.id || `MIE-${Date.now().toString().slice(-6)}`;
    document.getElementById('cred-id').textContent = cleanId;

    const domPhoto = document.getElementById('cred-photo');
    if (data.foto) {
        const safeFoto = await loadImageSafe(data.foto);
        domPhoto.src = safeFoto || "img/default-avatar.png";
    } else { domPhoto.src = "img/default-avatar.png"; }

    const domQr = document.getElementById('cred-qr');
    domQr.innerHTML = '';
    try {
        const qrPayload = {
            t: 'cred',
            id: cleanId,
            n: data.nombre,
            r: data.rol,
            e: data.estado || '',
            c: data.circulo || '',
            curp: data.curp || '',
            ts: Date.now()
        };
        new QRCode(domQr, {
            text: JSON.stringify(qrPayload),
            width: 70, height: 70, colorDark: "#000000", colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    } catch(e) { }

    await new Promise(r => setTimeout(r, 400));

    try {
        const canvas = await html2canvas(cardElement, { scale: 2, useCORS: true, logging: false, backgroundColor: null });
        const link = document.createElement('a');
        link.download = `Credencial_${data.nombre.replace(/\s+/g, '_')}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    } catch (err) { alert("Tu navegador bloqueo la descarga."); }
};

// ======================================================
// 3. PDF DE CIRCULO (ACTA CONSTITUTIVA)
// ======================================================

window.generateCirclePDF = async function(circleData) {
    if (!window.jspdf) { alert("Error: Libreria PDF no cargada."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'letter', unit: 'mm' });

    const pageWidth = 215.9;
    const pageHeight = 279.4;
    const margin = 14;
    const pageEnd = 255;
    const lineSpacing = 5.5;
    const textWidth = pageWidth - (margin * 2);
    let yPos = 0;

    function addPdfHeader(doc, yStart = 14) {
        const logoMcData = getLogoData('logoMC');
        const logoCirculosData = getLogoData('logoCirculos');
        if (logoMcData) doc.addImage(logoMcData, 'PNG', margin, yStart - 5, 25, 25);
        if (logoCirculosData) {
            const w = 50; const h = 25;
            doc.addImage(logoCirculosData, 'PNG', pageWidth - margin - w, yStart - 5, w, h);
        }
        doc.setDrawColor(200);
        doc.line(margin, yStart + 25, pageWidth - margin, yStart + 25);
        return yStart + 35;
    }

    function checkPageBreak(currentY, neededSpace = 0) {
        if (currentY + neededSpace > pageEnd) {
            doc.addPage();
            return addPdfHeader(doc, margin);
        }
        return currentY;
    }

    function formatUserRol(rolString) {
        if (!rolString) return "Promotor Ciudadano";
        return rolString.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    yPos = addPdfHeader(doc, margin);

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor("#000000");
    const centerX = pageWidth / 2;

    doc.text("ACTA CONSTITUTIVA PARA LA CONFORMACION DE UN", centerX, yPos, { align: 'center' });
    yPos += lineSpacing;
    doc.text("CIRCULO CIUDADANO EN EL ESTADO DE", centerX, yPos, { align: 'center' });
    yPos += lineSpacing;
    doc.setFont("helvetica", "normal");
    doc.text((circleData.acta.estado || "").toUpperCase(), centerX, yPos, { align: 'center' });
    yPos += (lineSpacing * 2);

    const seccionText = circleData.acta.seccion ? `  |  Seccion Electoral: ${circleData.acta.seccion}` : '';
    doc.text(`En el Municipio/Alcaldia de: ${circleData.acta.municipio}${seccionText}`, margin, yPos);
    yPos += lineSpacing * 1.5;

    const fechaObj = new Date(circleData.acta.fecha + 'T12:00:00');
    const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const fechaTexto = fechaObj.toLocaleDateString('es-MX', optionsDate);
    doc.text(`El dia ${fechaTexto},`, margin, yPos);
    yPos += (lineSpacing * 2);

    let nombreCreador = "Ciudadano Distinguido";
    let rolCreador = "Promotor Ciudadano";

    if (window.CRM && window.CRM.APP && window.CRM.APP.users) {
        const creatorUser = window.CRM.APP.users.find(u => u.usuario === circleData.coordinador_usuario);
        if (creatorUser) {
            nombreCreador = creatorUser.nombre;
            rolCreador = creatorUser.rol;
        } else if (circleData.acta.coordinador) {
            nombreCreador = circleData.acta.coordinador;
        }
    }

    doc.text("El/La C.", margin, yPos);
    doc.setFont("helvetica", "bold");
    doc.text(nombreCreador, margin + 15, yPos);
    doc.setFont("helvetica", "normal");
    yPos += lineSpacing;

    doc.text("en su caracter de:", margin, yPos);
    doc.setFont("helvetica", "bold");
    doc.text(formatUserRol(rolCreador), margin + 40, yPos);
    doc.setFont("helvetica", "normal");
    yPos += lineSpacing;

    const txt1 = "perteneciente al Distrito Electoral o Municipio mencionado anteriormente de Circulos Ciudadanos de Movimiento Ciudadano, hace CONSTAR LA CONFORMACION DEL CIRCULO CIUDADANO de conformidad con los Estatutos de Movimiento Ciudadano y el Reglamento de los Circulos Ciudadanos al tenor de las siguientes:";
    const lines1 = doc.splitTextToSize(txt1, textWidth);
    doc.text(lines1, margin, yPos);
    yPos += (lines1.length * lineSpacing) + lineSpacing;

    doc.setFontSize(13); doc.setFont("helvetica", "bold");
    doc.text("DECLARACIONES", centerX, yPos, { align: 'center' });
    yPos += (lineSpacing * 1.5);

    doc.setFontSize(11); doc.setFont("helvetica", "bold");
    doc.text("PRIMERO. -", margin, yPos);
    doc.setFont("helvetica", "normal");
    yPos += lineSpacing;

    const txt2 = `Siendo las ${circleData.acta.hora || '12:00'} horas del dia ${fechaTexto} se reunieron las personas de la lista anexa, como parte integral de esta acta, y proporcionaron voluntariamente sus datos generales, manifestando con entusiasmo y conviccion contribuir a una mejora para su comunidad facilitando la organizacion de ciudadanos comprometidos.`;
    const lines2 = doc.splitTextToSize(txt2, textWidth);
    doc.text(lines2, margin, yPos);
    yPos += (lines2.length * lineSpacing) + lineSpacing;

    let tituloSeccion = "CAUSAS Y ACTIVIDADES:";
    let temas = [];
    if (circleData.actividades && circleData.actividades.length > 0) {
        tituloSeccion = "ACTIVIDADES TEMATICAS:";
        temas = circleData.actividades;
    } else if (circleData.causas && circleData.causas.length > 0) {
        tituloSeccion = "CAUSAS SOCIALES:";
        temas = circleData.causas;
    } else if (circleData.options) {
        temas = circleData.options;
    }

    doc.text(`Manifestando como nuestras ${tituloSeccion.toLowerCase()} las siguientes:`, margin, yPos);
    yPos += lineSpacing * 1.5;

    doc.setFont("helvetica", "bold");
    temas.forEach((tema, index) => {
        doc.text(`${String.fromCharCode(65 + index)}) ${tema}`, margin + 5, yPos);
        yPos += lineSpacing;
    });
    doc.setFont("helvetica", "normal");
    yPos += lineSpacing * 2;

    yPos = checkPageBreak(yPos);

    let nombreCoordinadorCirculo = circleData.acta.coordinador;
    const integranteCoordinador = circleData.cedulas.find(c => c.es_coordinador === true);
    if (integranteCoordinador) nombreCoordinadorCirculo = integranteCoordinador.nombre;

    doc.setFont("helvetica", "bold");
    doc.text("SEGUNDO. -", margin, yPos);
    doc.setFont("helvetica", "normal");

    const txt3 = `Se procede a designar al / la Coordinadora (o) del Circulo Ciudadano, nombramiento que recayo en el o la C. ${nombreCoordinadorCirculo.toUpperCase()} y que en este acto tanto el como los demas integrantes, aceptan de manera voluntaria el nombramiento con caracter honorifico para desarrollar las actividades que mejor crean convenientes en beneficio de todas y todos.`;
    const lines3 = doc.splitTextToSize(txt3, textWidth);
    doc.text(lines3, margin, yPos + lineSpacing);
    yPos += (lines3.length * lineSpacing) + lineSpacing;

    yPos = checkPageBreak(yPos);

    doc.setFont("helvetica", "bold");
    doc.text("TERCERO. -", margin, yPos);
    doc.setFont("helvetica", "normal");
    yPos += lineSpacing;
    const txt4 = "Las y los integrantes de este Circulo Ciudadano manifiestan su total y plena voluntad de organizarse bajo la estructura establecida sin presion alguna, compra, coaccion, entrega de beneficios materiales o dadivas que puedan comprometer las actividades a desarrollar.";
    const lines4 = doc.splitTextToSize(txt4, textWidth);
    doc.text(lines4, margin, yPos);
    yPos += (lines4.length * lineSpacing) + lineSpacing;

    yPos = checkPageBreak(yPos);

    doc.setFont("helvetica", "bold");
    doc.text("CUARTO. -", margin, yPos);
    doc.setFont("helvetica", "normal");
    yPos += lineSpacing;
    const txt5 = "A continuacion, rindieron protesta como integrantes del Circulo Ciudadano conformado, quienes expresan de manera libre y en su condicion de ciudadanas y ciudadanos su voluntad de integrar esta organizacion.";
    const lines5 = doc.splitTextToSize(txt5, textWidth);
    doc.text(lines5, margin, yPos);
    yPos += (lines5.length * lineSpacing) + lineSpacing;

    yPos = checkPageBreak(yPos, 40);

    doc.setFont("helvetica", "bold");
    doc.text("LISTA DE ASISTENCIA Y FIRMAS", margin, yPos);
    yPos += lineSpacing * 2;

    doc.setFontSize(10);
    doc.text("NOMBRE", margin, yPos);
    doc.text("FIRMA (Debe coincidir c/INE)", margin + 110, yPos);
    yPos += lineSpacing;

    doc.setFont("helvetica", "normal");
    for (let i = 0; i < circleData.cedulas.length; i++) {
        yPos = checkPageBreak(yPos, 25);
        const ced = circleData.cedulas[i];
        doc.text(`${i + 1}. ${ced.nombre}`, margin, yPos);
        doc.text("__________________________", margin + 110, yPos);
        if (ced.firma && !ced.firma.startsWith('DIGITAL:')) {
            // firma puede ser base64 (recién capturada) o URL (cargada del servidor)
            const firmaImg = await loadImageSafe(ced.firma);
            if (firmaImg) {
                try { doc.addImage(firmaImg, 'PNG', margin + 115, yPos - 8, 30, 10); } catch(e) {}
            }
        }
        yPos += lineSpacing * 2.5;
    }

    for (let i = 0; i < circleData.cedulas.length; i++) {
        const ced = circleData.cedulas[i];
        doc.addPage();
        yPos = addPdfHeader(doc, 14);

        doc.setFillColor(255, 126, 0);
        doc.rect(margin, yPos, textWidth, 10, 'F');
        doc.setTextColor(255);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(`CEDULA DE INTEGRANTE (${i + 1}/${circleData.cedulas.length})`, margin + 5, yPos + 7);
        if (ced.es_coordinador) {
            doc.setFontSize(10);
            doc.text("[ COORDINADOR ]", pageWidth - margin - 40, yPos + 7);
        }

        yPos += 18;
        doc.setTextColor(0);
        doc.setFontSize(10);

        const col1 = margin;
        const col2 = 110;

        const printField = (label, val, x, y) => {
            doc.setFont("helvetica", "bold");
            doc.text(label, x, y);
            doc.setFont("helvetica", "normal");
            doc.text(val || 'N/A', x + 28, y);
        };

        printField("Nombre:", ced.nombre, col1, yPos);
        yPos += 7;
        printField("Telefono:", ced.telefono, col1, yPos);
        printField("Email:", ced.email, col2, yPos);
        yPos += 7;
        printField("Clave Elec:", ced.clave_elector, col1, yPos);
        printField("Seccion:", ced.seccion, col2, yPos);
        yPos += 7;
        printField("CURP:", ced.curp, col1, yPos);
        printField("Fecha Nac:", ced.fecha_nacimiento, col2, yPos);
        yPos += 7;

        doc.setFont("helvetica", "bold"); doc.text("Domicilio:", col1, yPos);
        doc.setFont("helvetica", "normal");
        const domLines = doc.splitTextToSize(ced.domicilio || 'N/A', textWidth - 30);
        doc.text(domLines, col1 + 28, yPos);
        yPos += (domLines.length * 5) + 10;

        const ineSrc = ced.ine_frente || ced.ine_data;
        const fotoSrc = ced.foto || ced.foto_perfil;

        if (ineSrc) {
            try {
                const imgData = await loadImageSafe(ineSrc);
                if (imgData) {
                    doc.setFont("helvetica", "bold"); doc.text("INE (Frente):", col1, yPos);
                    doc.addImage(imgData, 'JPEG', col1, yPos + 5, 85, 55);
                }
            } catch (err) { }
        }

        if (fotoSrc) {
            try {
                const imgData = await loadImageSafe(fotoSrc);
                if (imgData) {
                    doc.setFont("helvetica", "bold"); doc.text("FOTO:", col2, yPos);
                    doc.addImage(imgData, 'JPEG', col2, yPos + 5, 40, 40);
                }
            } catch(e) {}
        }

        yPos += 65;

        doc.setFont("helvetica", "bold"); doc.text("Firma de Conformidad:", margin, yPos);
        yPos += 5;
        if (ced.firma && ced.firma.startsWith("DIGITAL:")) {
            doc.setFont("courier", "italic");
            doc.text(ced.firma.replace("DIGITAL:", ""), margin, yPos + 10);
            doc.setFont("helvetica", "normal");
        } else if (ced.firma) {
            // firma puede ser base64 (recién capturada) o URL (cargada del servidor)
            const firmaImg = await loadImageSafe(ced.firma);
            if (firmaImg) {
                try { doc.addImage(firmaImg, 'PNG', margin, yPos, 50, 15); } catch(e) {}
            }
        }
        doc.line(margin, yPos + 18, margin + 60, yPos + 18);

        if (pageHeight - margin - yPos < 35) { doc.addPage(); yPos = addPdfHeader(doc, 14); }
        else { yPos = pageHeight - 40; }

        doc.setFontSize(7);
        doc.setTextColor("#444444");
        doc.setFont("helvetica", "bold");
        doc.text("Aviso de privacidad simplificado:", margin, yPos);
        yPos += 4;

        doc.setFont("helvetica", "normal");
        const avisoCuerpo = "Movimiento Ciudadano, es responsable del tratamiento de los datos personales que nos proporcione, los cuales seran protegidos conforme lo dispuesto por la Ley General de Proteccion de Datos Personales en Posesion de Sujetos Obligados y demas normatividad que resulte aplicable. Los datos recabados, los utilizaremos para las siguientes finalidades: Verificar y confirmar su identidad, integrar expedientes y bases de datos, e invitacion a eventos. No se realizaran transferencias de datos personales, salvo aquellas necesarias para atender requerimientos de autoridad competente.";
        const linesAviso = doc.splitTextToSize(avisoCuerpo, textWidth);
        doc.text(linesAviso, margin, yPos);
    }

    doc.save(`Acta_Circulo_${circleData.acta.nombre.replace(/\s+/g, '_')}.pdf`);
};

// ======================================================
// 4. REPORTE DE AVANCE ESTATAL (v2 - MEJORADO)
// ======================================================

window.handleExportStatePDF = function() {
    const estado = document.getElementById('reporte_estado_select')?.value;
    const destinatario = document.getElementById('reporte_destinatario')?.value || "Coordinacion Estatal";

    if (!estado) { alert("Selecciona un estado."); return; }
    if (!window.jspdf) { alert("La libreria PDF no esta cargada. Recarga la pagina e intenta de nuevo."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'letter', unit: 'mm' });
    const pageWidth  = 215.9;
    const pageHeight = 279.4;
    const margin     = 14;
    const textWidth  = pageWidth - margin * 2;
    const centerX    = pageWidth / 2;

    const logoMc       = getLogoData('logoMC');
    const logoCirculos = getLogoData('logoCirculos');

    // --- helper: encabezado de paginas interiores ---
    function addInteriorHeader() {
        if (logoMc)       doc.addImage(logoMc,       'PNG', margin,                     9,  18, 18);
        if (logoCirculos) doc.addImage(logoCirculos,  'PNG', pageWidth - margin - 38,    9,  38, 18);
        doc.setFillColor(255, 126, 0);
        doc.rect(0, 29, pageWidth, 1.5, 'F');
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(130, 130, 130);
        doc.text(
            `Reporte de Avance: ${estado}  |  ${new Date().toLocaleDateString('es-MX')}  |  DOCUMENTO CONFIDENCIAL`,
            centerX, 35, { align: 'center' }
        );
        return 42;
    }

    // --- helper: barra horizontal coloreada ---
    function drawHBar(x, y, value, maxValue, barW, barH, rgb) {
        const fillW = maxValue > 0 ? Math.max((value / maxValue) * barW, 1) : 0;
        doc.setFillColor(220, 220, 220);
        doc.roundedRect(x, y, barW, barH, barH / 2, barH / 2, 'F');
        if (fillW > 0) {
            doc.setFillColor(rgb[0], rgb[1], rgb[2]);
            doc.roundedRect(x, y, fillW, barH, barH / 2, barH / 2, 'F');
        }
    }

    // ================================================================
    // PROCESAMIENTO CENTRAL DE DATOS
    // ================================================================
    const { circles, users } = window.getAccessibleData
        ? window.getAccessibleData()
        : { circles: window.CRM.APP.circles, users: window.CRM.APP.users };

    const municipioFiltro = (document.getElementById('reporte_municipio_select')?.value || '').toUpperCase();
    const stateCircles = circles.filter(c => {
        if (c?.acta?.estado !== estado) return false;
        if (municipioFiltro && (c.acta.municipio || '').toUpperCase() !== municipioFiltro) return false;
        return true;
    });
    const stateUsers   = users.filter(u => u.estado === estado);

    // Secciones electorales unicas
    const seccionesUnicas = new Set();
    stateCircles.forEach(c => {
        if (c.cedulas) c.cedulas.forEach(m => { if (m.seccion) seccionesUnicas.add(m.seccion.trim()); });
    });

    // Meta y porcentajes
    let totalSecciones = window.CRM?.SECCIONES_POR_ESTADO?.[estado] || 0;
    const metaEstado       = Math.ceil(totalSecciones > 0 ? totalSecciones * 2.5 : 1000);
    const pctCirculos      = metaEstado > 0 ? parseFloat(((stateCircles.length / metaEstado) * 100).toFixed(1)) : 0;
    const pctSecciones     = totalSecciones > 0 ? parseFloat(((seccionesUnicas.size / totalSecciones) * 100).toFixed(2)) : 0;
    const totalIntegrantes = stateCircles.reduce((acc, c) => acc + (c.cedulas ? c.cedulas.length : 0), 0);

    // Ventanas de tiempo para tendencia
    const now = new Date();
    const d30 = new Date(); d30.setDate(now.getDate() - 30);
    const d60 = new Date(); d60.setDate(now.getDate() - 60);

    function fechaCirculo(c) {
        const ds = c?.acta?.fecha || (c.timestamp ? c.timestamp.split('T')[0] : null);
        return ds ? new Date(ds + 'T12:00:00') : null;
    }

    const circRecientes  = stateCircles.filter(c => { const f = fechaCirculo(c); return f && f >= d30; }).length;
    const circAnteriores = stateCircles.filter(c => { const f = fechaCirculo(c); return f && f >= d60 && f < d30; }).length;
    const tendenciaEstado = circRecientes > circAnteriores ? 'ALZA'
                          : circRecientes < circAnteriores ? 'BAJA' : 'ESTABLE';

    // Municipios (agrupados y ordenados)
    const porMunicipio = {};
    stateCircles.forEach(c => {
        const mun = c?.acta?.municipio || 'Sin Municipio';
        if (!porMunicipio[mun]) porMunicipio[mun] = { circulos: 0, integrantes: 0 };
        porMunicipio[mun].circulos++;
        porMunicipio[mun].integrantes += c.cedulas ? c.cedulas.length : 0;
    });
    const municipiosSorted = Object.entries(porMunicipio).sort((a, b) => b[1].circulos - a[1].circulos);

    // Diccionario de roles
    const rolesDic = {
        'admin': 'Administrador del Sistema',
        'secretario_nacional': 'Secretario Nacional',
        'validacion': 'Mesa de Validacion',
        'secretario_estatal': 'Secretario Estatal',
        'secretario_municipal': 'Secretario Municipal',
        'coordinador_distrital_federal': 'Coord. Distrital Federal',
        'coordinador_distrital_local': 'Coord. Distrital Local',
        'delegado_estatal_jovenes': 'Coord. de Jovenes',
        'delegado_estatal_mujeres': 'Coord. de Mujeres',
        'delegado_estatal_trabajadores': 'Coord. de Trabajadores',
        'coordinador_estatal_usa': 'Mov. Migrante (USA)',
        'delegado_estatal_fundacion': 'Coord. de Fundacion',
        'regidor': 'Regidor', 'sindico': 'Sindico',
        'diputado_local': 'Diputado Local', 'diputado_federal': 'Diputado Federal'
    };
    (window.CRM?.APP?.customRoles || []).forEach(r => { rolesDic[r.value] = r.label; });

    // Desempeno por usuario con tendencia individual
    const usersDesempeno = stateUsers.map(u => {
        const misC      = stateCircles.filter(c => c.coordinador_usuario === u.usuario);
        const recientes = misC.filter(c => { const f = fechaCirculo(c); return f && f >= d30; }).length;
        const ant       = misC.filter(c => { const f = fechaCirculo(c); return f && f >= d60 && f < d30; }).length;
        const misInt    = misC.reduce((acc, c) => acc + (c.cedulas ? c.cedulas.length : 0), 0);
        const rol       = u.rol || '';
        const roleName  = rolesDic[rol] || window.toTitleCase(rol.replace(/_/g, ' ')) || 'Sin cargo';

        let textoStatus = 'En Ceros';
        if (misC.length > 0 && recientes === 0) textoStatus = 'Estancado';
        else if (recientes > 0)                  textoStatus = 'Activo';

        const tendencia = recientes > ant ? 'ALZA' : recientes < ant ? 'BAJA' : 'IGUAL';

        return { u, roleName, total: misC.length, recientes, ant, misInt, textoStatus, tendencia };
    }).sort((a, b) => b.total - a.total);

    const maxCirculos = usersDesempeno.length > 0 ? Math.max(usersDesempeno[0].total, 1) : 1;

    // ================================================================
    // PAGINA 1: PORTADA CORPORATIVA
    // ================================================================
    // Franja naranja superior (60% de la pagina)
    doc.setFillColor(255, 126, 0);
    doc.rect(0, 0, pageWidth, 105, 'F');
    doc.setFillColor(200, 80, 0);
    doc.rect(0, 93, pageWidth, 12, 'F');

    // Logos en portada
    if (logoMc)       doc.addImage(logoMc,       'PNG', margin,                     10, 32, 32);
    if (logoCirculos) doc.addImage(logoCirculos,  'PNG', pageWidth - margin - 58,    12, 58, 29);

    // Titulo principal (blanco sobre naranja)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("CIRCULOS CIUDADANOS  |  MOVIMIENTO CIUDADANO", centerX, 57, { align: 'center' });
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text("REPORTE DE AVANCE", centerX, 70, { align: 'center' });
    doc.setFontSize(30);
    doc.text(estado.toUpperCase(), centerX, 88, { align: 'center' });

    // Bloque de metadata (fondo blanco)
    doc.setTextColor(51, 51, 51);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Dirigido a:", margin + 8, 120);
    doc.setFont("helvetica", "normal");
    doc.text(destinatario, margin + 8, 128);

    doc.setFont("helvetica", "bold");
    doc.text("Fecha de Corte:", margin + 8, 140);
    doc.setFont("helvetica", "normal");
    doc.text(
        now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
        margin + 8, 148
    );

    doc.setDrawColor(210, 210, 210);
    doc.line(margin + 8, 154, pageWidth - margin - 8, 154);

    // 4 KPIs en portada
    const kpiY = 161;
    const kpiW = (textWidth - 30) / 4;

    function drawKPI(x, y, valor, label, r, g, b) {
        doc.setFillColor(r, g, b);
        doc.roundedRect(x, y, kpiW, 26, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20); doc.setFont("helvetica", "bold");
        doc.text(valor.toString(), x + kpiW / 2, y + 15, { align: 'center' });
        doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
        doc.text(label, x + kpiW / 2, y + 22, { align: 'center' });
    }

    drawKPI(margin,                         kpiY, stateCircles.length,  'CIRCULOS',    255, 126,   0);
    drawKPI(margin + (kpiW + 10),           kpiY, stateUsers.length,    'ESTRUCTURA',   13,  71, 161);
    drawKPI(margin + (kpiW + 10) * 2,       kpiY, totalIntegrantes,     'INTEGRANTES',  40, 167,  69);
    drawKPI(margin + (kpiW + 10) * 3,       kpiY, seccionesUnicas.size, 'SECCIONES',   103,  58, 183);

    // Indicador de tendencia estatal
    const tRGB   = tendenciaEstado === 'ALZA'   ? [40, 167, 69]
                 : tendenciaEstado === 'BAJA'   ? [220, 53, 69] : [100, 100, 100];
    const tLabel = tendenciaEstado === 'ALZA'   ? `+${circRecientes} circulos en 30 dias (vs ${circAnteriores} periodo anterior)`
                 : tendenciaEstado === 'BAJA'   ? `${circRecientes} circulos en 30 dias (vs ${circAnteriores} periodo anterior)`
                 :                                `${circRecientes} circulos en 30 dias - ritmo estable`;
    doc.setFillColor(tRGB[0], tRGB[1], tRGB[2]);
    doc.roundedRect(margin, kpiY + 32, textWidth, 9, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text(`TENDENCIA: ${tendenciaEstado}  |  ${tLabel}`, centerX, kpiY + 38, { align: 'center' });

    // Barra de progreso a meta 2027
    const barY = kpiY + 50;
    doc.setTextColor(51, 51, 51);
    doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text(`Avance hacia Meta 2027:  ${pctCirculos}%   (${stateCircles.length} de ${metaEstado} circulos)`, margin, barY);
    doc.setFillColor(220, 220, 220);
    doc.roundedRect(margin, barY + 4, textWidth, 7, 3, 3, 'F');
    if (pctCirculos > 0) {
        const bColor = pctCirculos >= 75 ? [40, 167, 69] : pctCirculos >= 40 ? [255, 193, 7] : [255, 126, 0];
        const bFill  = Math.min((pctCirculos / 100) * textWidth, textWidth);
        doc.setFillColor(bColor[0], bColor[1], bColor[2]);
        doc.roundedRect(margin, barY + 4, Math.max(bFill, 3), 7, 3, 3, 'F');
    }

    // Pie de portada
    doc.setFillColor(255, 126, 0);
    doc.rect(0, pageHeight - 14, pageWidth, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
    doc.text('DOCUMENTO CONFIDENCIAL  |  USO INTERNO  |  CIRCULOS CIUDADANOS', centerX, pageHeight - 5, { align: 'center' });

    // ================================================================
    // PAGINA 2: TOP 3 + BARRAS DE PRODUCTIVIDAD + TABLA SEMAFORO
    // ================================================================
    doc.addPage();
    let yPos = addInteriorHeader();

    // --- PODIO TOP 3 ---
    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
    doc.text("Top 3 Coordinadores del Estado", margin, yPos);
    yPos += 6;

    const top3         = usersDesempeno.slice(0, 3);
    const podioColors  = [[255, 193, 7], [180, 180, 180], [180, 110, 55]];
    const podioLabels  = ['#1  ORO', '#2  PLATA', '#3  BRONCE'];
    const podioW       = (textWidth - 20) / 3;

    if (top3.length === 0) {
        doc.setFontSize(9); doc.setTextColor(130, 130, 130);
        doc.text("Sin coordinadores registrados en este estado.", margin, yPos + 8);
        yPos += 18;
    } else {
        top3.forEach((item, i) => {
            const px = margin + i * (podioW + 10);
            doc.setFillColor(podioColors[i][0], podioColors[i][1], podioColors[i][2]);
            doc.roundedRect(px, yPos, podioW, 24, 3, 3, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7.5); doc.setFont("helvetica", "bold");
            doc.text(podioLabels[i], px + podioW / 2, yPos + 7, { align: 'center' });
            doc.setFontSize(8.5);
            const nombre = (window.toTitleCase(item.u.nombre || '')).substring(0, 24);
            doc.text(nombre, px + podioW / 2, yPos + 14, { align: 'center' });
            doc.setFontSize(15);
            doc.text(`${item.total}`, px + podioW / 2, yPos + 22, { align: 'center' });
        });
        yPos += 32;
    }

    // --- BARRAS HORIZONTALES (top 12) ---
    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
    doc.text("Productividad por Coordinador", margin, yPos);
    yPos += 5;

    const top12    = usersDesempeno.slice(0, 12);
    const barChartW = 95;

    top12.forEach(item => {
        if (yPos > 258) return;
        const rgb = item.textoStatus === 'Activo'    ? [40, 167, 69]
                  : item.textoStatus === 'Estancado' ? [255, 193, 7] : [220, 53, 69];

        doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(51, 51, 51);
        doc.text((window.toTitleCase(item.u.nombre || '')).substring(0, 27), margin, yPos + 4.5);

        drawHBar(margin + 68, yPos, item.total, maxCirculos, barChartW, 6, rgb);

        doc.setFont("helvetica", "bold"); doc.setTextColor(rgb[0], rgb[1], rgb[2]);
        doc.text(`${item.total}`, margin + 68 + barChartW + 3, yPos + 5);

        const trendRGB   = item.tendencia === 'ALZA' ? [40, 167, 69] : item.tendencia === 'BAJA' ? [220, 53, 69] : [140, 140, 140];
        const trendLabel = item.tendencia === 'ALZA' ? 'ALZA' : item.tendencia === 'BAJA' ? 'BAJA' : 'IGUAL';
        doc.setTextColor(trendRGB[0], trendRGB[1], trendRGB[2]);
        doc.text(trendLabel, margin + 68 + barChartW + 18, yPos + 5);

        yPos += 9;
    });
    yPos += 4;

    // --- TABLA SEMAFORO COMPLETA ---
    if (yPos > 205) { doc.addPage(); yPos = addInteriorHeader(); }

    doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
    doc.text("Desglose General de Productividad", margin, yPos);
    yPos += 3;

    const bodySemaforo = usersDesempeno.map(item => [
        `${window.toTitleCase(item.u.nombre || '')}\n${item.roleName}`,
        item.u.municipio || '-',
        item.total.toString(),
        `+${item.recientes}`,
        item.misInt.toString(),
        item.textoStatus,
        item.tendencia
    ]);
    if (bodySemaforo.length === 0) bodySemaforo.push(['Sin estructura registrada.', '-', '0', '0', '0', '-', '-']);

    doc.autoTable({
        startY: yPos,
        head: [['Nombre / Cargo', 'Municipio', 'Total', '+30 Dias', 'Integrantes', 'Estatus', 'Tendencia']],
        body: bodySemaforo,
        theme: 'grid',
        headStyles: { fillColor: [51, 51, 51], fontSize: 8 },
        styles: { fontSize: 7.5, cellPadding: 2.5 },
        columnStyles: {
            2: { halign: 'center', fontStyle: 'bold' },
            3: { halign: 'center', fontStyle: 'bold' },
            4: { halign: 'center' },
            5: { halign: 'center', fontStyle: 'bold' },
            6: { halign: 'center', fontStyle: 'bold' }
        },
        didParseCell: function(data) {
            if (data.section !== 'body') return;
            if (data.column.index === 5) {
                if (data.cell.raw.includes('En Ceros'))  { data.cell.styles.textColor = [220, 53, 69];  data.cell.styles.fillColor = [248, 215, 218]; }
                if (data.cell.raw.includes('Estancado')) { data.cell.styles.textColor = [133, 100, 4];  data.cell.styles.fillColor = [255, 243, 205]; }
                if (data.cell.raw.includes('Activo'))    { data.cell.styles.textColor = [21,  87,  36]; data.cell.styles.fillColor = [212, 237, 218]; }
            }
            if (data.column.index === 6) {
                if (data.cell.raw === 'ALZA') { data.cell.styles.textColor = [21, 87, 36];   data.cell.styles.fillColor = [212, 237, 218]; }
                if (data.cell.raw === 'BAJA') { data.cell.styles.textColor = [220, 53, 69];  data.cell.styles.fillColor = [248, 215, 218]; }
                if (data.cell.raw === 'IGUAL'){ data.cell.styles.textColor = [100, 100, 100]; }
            }
        }
    });

    // ================================================================
    // PAGINA 3: CIRCULOS POR MUNICIPIO
    // ================================================================
    doc.addPage();
    yPos = addInteriorHeader();

    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
    doc.text("Distribucion de Circulos por Municipio", margin, yPos);
    yPos += 4;

    const bodyMun = municipiosSorted.map(([mun, d]) => {
        const pct = stateCircles.length > 0 ? ((d.circulos / stateCircles.length) * 100).toFixed(1) : '0.0';
        return [mun, d.circulos.toString(), d.integrantes.toString(), `${pct}%`];
    });
    if (bodyMun.length === 0) bodyMun.push(['Sin datos de municipios', '0', '0', '0%']);

    doc.autoTable({
        startY: yPos,
        head: [['Municipio / Alcaldia', 'Circulos', 'Integrantes', '% del Total Estatal']],
        body: bodyMun,
        theme: 'striped',
        headStyles: { fillColor: [13, 71, 161] },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
            1: { halign: 'center', fontStyle: 'bold', textColor: [255, 126, 0] },
            2: { halign: 'center' },
            3: { halign: 'center' }
        },
        didParseCell: function(data) {
            if (data.section === 'body' && data.row.index === 0) {
                data.cell.styles.fillColor = [255, 243, 205];
                data.cell.styles.fontStyle = 'bold';
            }
        }
    });

    yPos = doc.lastAutoTable.finalY + 10;

    // Barras horizontales por municipio (top 8)
    if (yPos < 230 && municipiosSorted.length > 0) {
        doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
        doc.text("Concentracion por Municipio (Top 8)", margin, yPos);
        yPos += 5;

        const maxMun    = municipiosSorted[0][1].circulos;
        const barMunW   = 115;

        municipiosSorted.slice(0, 8).forEach(([mun, d]) => {
            if (yPos > 262) return;
            doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(51, 51, 51);
            doc.text(mun.substring(0, 32), margin, yPos + 4.5);
            drawHBar(margin + 68, yPos, d.circulos, maxMun, barMunW, 6, [13, 71, 161]);
            doc.setFont("helvetica", "bold"); doc.setTextColor(13, 71, 161);
            doc.text(`${d.circulos}`, margin + 68 + barMunW + 3, yPos + 5);
            yPos += 9;
        });
    }

    // ================================================================
    // PAGINA 4: COBERTURA SECCIONAL
    // ================================================================
    doc.addPage();
    yPos = addInteriorHeader();

    doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
    doc.text("Cobertura de Secciones Electorales", margin, yPos);
    yPos += 6;

    // 3 KPI cards de cobertura
    const covW = (textWidth - 20) / 3;

    function drawCovCard(x, y, valor, label, r, g, b) {
        doc.setFillColor(r, g, b);
        doc.roundedRect(x, y, covW, 24, 3, 3, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18); doc.setFont("helvetica", "bold");
        doc.text(valor.toString(), x + covW / 2, y + 14, { align: 'center' });
        doc.setFontSize(6.5); doc.setFont("helvetica", "normal");
        doc.text(label, x + covW / 2, y + 21, { align: 'center' });
    }

    drawCovCard(margin,                   yPos, seccionesUnicas.size,                        'SECCIONES CUBIERTAS',     103,  58, 183);
    drawCovCard(margin + covW + 10,       yPos, totalSecciones > 0 ? totalSecciones : 'N/D', 'TOTAL SECCIONES ESTADO',   51,  51,  51);
    const covColor = pctSecciones >= 50 ? [40, 167, 69] : pctSecciones >= 20 ? [255, 126, 0] : [220, 53, 69];
    drawCovCard(margin + (covW + 10) * 2, yPos, totalSecciones > 0 ? `${pctSecciones}%` : 'N/D', 'COBERTURA SECCIONAL', covColor[0], covColor[1], covColor[2]);

    yPos += 32;

    // Barra de cobertura seccional
    if (totalSecciones > 0) {
        doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
        doc.text(`Progreso de cobertura seccional: ${seccionesUnicas.size} / ${totalSecciones}`, margin, yPos);
        doc.setFillColor(220, 220, 220);
        doc.roundedRect(margin, yPos + 4, textWidth, 7, 3, 3, 'F');
        if (pctSecciones > 0) {
            const secFill = Math.min((pctSecciones / 100) * textWidth, textWidth);
            doc.setFillColor(103, 58, 183);
            doc.roundedRect(margin, yPos + 4, Math.max(secFill, 3), 7, 3, 3, 'F');
        }
        yPos += 18;
    }

    // Listado de secciones cubiertas (hasta 200; en columnas)
    if (seccionesUnicas.size > 0 && seccionesUnicas.size <= 200) {
        doc.setFontSize(9); doc.setFont("helvetica", "bold"); doc.setTextColor(51, 51, 51);
        doc.text("Secciones con presencia de Circulos Ciudadanos:", margin, yPos);
        yPos += 5;

        const secsArray = Array.from(seccionesUnicas).sort((a, b) => parseInt(a) - parseInt(b));
        const cols  = 6;
        const colW  = textWidth / cols;

        doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(51, 51, 51);
        secsArray.forEach((sec, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const px  = margin + col * colW;
            const py  = yPos + row * 5.5;
            if (py < 263) doc.text(sec.toString(), px, py);
        });
    } else if (seccionesUnicas.size > 200) {
        doc.setFontSize(8.5); doc.setFont("helvetica", "italic"); doc.setTextColor(100, 100, 100);
        doc.text(`(Listado omitido por volumen: ${seccionesUnicas.size} secciones cubiertas)`, margin, yPos);
    } else {
        doc.setFontSize(8.5); doc.setFont("helvetica", "italic"); doc.setTextColor(130, 130, 130);
        doc.text("No se han capturado numeros de seccion en las cedulas de este estado.", margin, yPos);
    }

    // ================================================================
    // GUARDAR
    // ================================================================
    doc.save(`Reporte_Avance_${estado.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
};

// ======================================================
// 5. REPORTE NACIONAL Y RANKINGS (PDF GAMIFICADO)
// ======================================================

window.handleExportReporteNacionalPDF = function() {
    if (!window.jspdf) { alert("Libreria PDF no cargada."); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'letter', unit: 'mm' });
    const pageWidth = 215.9;

    const logoMc = getLogoData('logoMC');
    if (logoMc) doc.addImage(logoMc, 'PNG', 14, 10, 20, 20);

    doc.setFillColor(255, 126, 0);
    doc.rect(0, 35, pageWidth, 2, 'F');

    doc.setTextColor(0);
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("REPORTE NACIONAL Y RANKING GENERAL", 40, 20);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Fecha de Corte: ${new Date().toLocaleDateString('es-MX')}`, 40, 28);
    doc.text(`Total de Circulos Validados: ${window.CRM.APP.circles.length}`, 40, 33);

    const { circles, users } = window.getAccessibleData
        ? window.getAccessibleData()
        : { circles: window.CRM.APP.circles, users: window.CRM.APP.users };

    const mapCirc = {
        "1a (Noroeste)":  ["Baja California", "Baja California Sur", "Chihuahua", "Durango", "Jalisco", "Nayarit", "Sinaloa", "Sonora"],
        "2a (Noreste)":   ["Aguascalientes", "Coahuila", "Guanajuato", "Nuevo León", "Querétaro", "San Luis Potosí", "Tamaulipas", "Zacatecas"],
        "3a (Sureste)":   ["Campeche", "Chiapas", "Oaxaca", "Quintana Roo", "Tabasco", "Veracruz", "Yucatán"],
        "4a (Centro-Sur)":["Ciudad de México", "Guerrero", "Morelos", "Puebla", "Tlaxcala"],
        "5a (Occidente)": ["Colima", "Estado de México", "Hidalgo", "Michoacán"]
    };

    // Ranking de estados
    doc.setFontSize(12); doc.setTextColor(255, 126, 0); doc.setFont("helvetica", "bold");
    doc.text("Ranking de Productividad por Estado", 14, 45);

    const stateRanking = ESTADOS_MX_PDF.map(est => {
        const cCount = circles.filter(c => c?.acta?.estado === est).length;
        const meta   = window.CRM?.SECCIONES_POR_ESTADO?.[est] ? Math.ceil(window.CRM.SECCIONES_POR_ESTADO[est] * 2.5) : 1000;
        return { estado: est, total: cCount, meta, pct: (cCount / meta) * 100 };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);

    const bodyState = stateRanking.map((s, i) => [`#${i + 1}`, s.estado, s.total.toString(), `${Math.min(s.pct, 100).toFixed(1)}%`]);
    if (bodyState.length === 0) bodyState.push(["-", "No hay circulos registrados", "0", "0%"]);

    doc.autoTable({
        startY: 50,
        head: [['Pos', 'Estado de la Republica', 'Circulos Totales', 'Avance Meta']],
        body: bodyState,
        theme: 'grid',
        headStyles: { fillColor: [255, 126, 0] },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { halign: 'center', fontStyle: 'bold', cellWidth: 15 },
            2: { halign: 'center', fontStyle: 'bold', textColor: [40, 167, 69] },
            3: { halign: 'center' }
        },
        didParseCell: function(data) {
            if (data.section === 'body') {
                if (data.row.index === 0) data.cell.styles.fillColor = [255, 243, 205];
                if (data.row.index === 1) data.cell.styles.fillColor = [240, 240, 240];
                if (data.row.index === 2) data.cell.styles.fillColor = [250, 235, 215];
            }
        }
    });

    let yPos = doc.lastAutoTable.finalY + 15;

    // Ranking general de coordinadores
    if (yPos > 230) { doc.addPage(); yPos = 20; }

    doc.setFontSize(14); doc.setTextColor(13, 71, 161); doc.setFont("helvetica", "bold");
    doc.text("Ranking General de Coordinadores", 14, yPos);

    const userRanking = users.map(u => {
        const misC = circles.filter(c => c.coordinador_usuario === u.usuario);
        const misI = misC.reduce((acc, c) => acc + (c.cedulas ? c.cedulas.length : 0), 0);
        let miCircunscripcion = "-";
        Object.entries(mapCirc).forEach(([cName, estados]) => {
            if (estados.includes(u.estado)) miCircunscripcion = cName.charAt(0) + "a";
        });
        return { nombre: u.nombre, estado: u.estado, region: miCircunscripcion, total: misC.length, integrantes: misI };
    }).filter(u => u.total > 0).sort((a, b) => b.total - a.total);

    const bodyRanking = userRanking.map((u, i) => [
        `${i + 1}o`, window.toTitleCase(u.nombre), u.estado, u.region, u.total.toString(), u.integrantes.toString()
    ]);
    if (bodyRanking.length === 0) bodyRanking.push(["-", "No hay registros", "-", "-", "0", "0"]);

    doc.autoTable({
        startY: yPos + 5,
        head: [['Pos', 'Coordinador(a)', 'Estado', 'Circ.', 'Circulos', 'Integrantes']],
        body: bodyRanking,
        theme: 'grid',
        headStyles: { fillColor: [13, 71, 161] },
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: {
            0: { halign: 'center', fontStyle: 'bold' },
            3: { halign: 'center' },
            4: { halign: 'center', fontStyle: 'bold', textColor: [13, 71, 161] },
            5: { halign: 'center' }
        },
        didParseCell: function(data) {
            if (data.section === 'body') {
                if (data.row.index === 0) { data.cell.styles.fillColor = [255, 243, 205]; data.cell.styles.textColor = [133, 100, 4]; data.cell.styles.fontStyle = 'bold'; }
                if (data.row.index === 1) { data.cell.styles.fillColor = [240, 240, 240]; data.cell.styles.textColor = [70, 70, 70];  data.cell.styles.fontStyle = 'bold'; }
                if (data.row.index === 2) { data.cell.styles.fillColor = [250, 235, 215]; data.cell.styles.textColor = [93, 64, 55];  data.cell.styles.fontStyle = 'bold'; }
            }
        }
    });

    doc.save(`Ranking_General_Circulos_${Date.now()}.pdf`);
};

// ======================================================
// 6. PDF LISTA DE ASISTENCIA A EVENTO
// ======================================================

window.generateEventAttendancePDF = function(eventId) {
    if (!window.jspdf) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const evento = window.CRM.APP.events.find(e => e.id === eventId);
    if (!evento) return;
    doc.setFillColor(255, 126, 0); doc.rect(0, 0, 210, 20, 'F');
    doc.setTextColor(255); doc.setFontSize(16);
    doc.text("LISTA DE ASISTENCIA", 105, 13, { align: 'center' });
    doc.setTextColor(0); doc.setFontSize(12);
    doc.text(evento.title, 14, 30);
    const body = (evento.asistentesConfirmados || []).map((a, i) => [i + 1, a, "ASISTIO"]);
    doc.autoTable({ startY: 45, head: [['#', 'Nombre', 'Estado']], body: body });
    doc.save("Asistencia.pdf");
};

// ======================================================
// 7. AUDITORIA DE VALIDACION (PDF)
// ======================================================

window.handleExportAuditoriaPDF = function() {
    if (!window.jspdf) { alert("Libreria PDF no cargada."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'letter', unit: 'mm' });
    const pageWidth = 215.9;

    const logoMc = getLogoData('logoMC');
    if (logoMc) doc.addImage(logoMc, 'PNG', 14, 10, 20, 20);

    doc.setFillColor(103, 58, 183);
    doc.rect(0, 35, pageWidth, 2, 'F');

    doc.setTextColor(0);
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("REPORTE DE AUDITORIA DE VALIDACION", 40, 20);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Fecha de Corte: ${new Date().toLocaleString('es-MX')}`, 40, 28);
    doc.text("Mesa de Control y Validacion Nacional", 40, 33);

    const data    = window.getAccessibleData ? window.getAccessibleData() : { circles: window.CRM.APP.circles };
    const circles = data.circles || [];

    let pendientes = 0, aprobados = 0, observados = 0;
    let rendimiento = {}, rezago = {};

    circles.forEach(c => {
        const status   = c.status || 'pendiente';
        const validador = c.validado_por || 'Sistema / Sin registro previo';
        const estado   = c?.acta?.estado || 'Sin Estado';

        if (status === 'pendiente' || status === '') {
            pendientes++;
            rezago[estado] = (rezago[estado] || 0) + 1;
        } else if (status === 'validado') {
            aprobados++;
            if (!rendimiento[validador]) rendimiento[validador] = { aprobados: 0, observados: 0 };
            rendimiento[validador].aprobados++;
        } else if (status === 'revision') {
            observados++;
            if (!rendimiento[validador]) rendimiento[validador] = { aprobados: 0, observados: 0 };
            rendimiento[validador].observados++;
        }
    });

    let yPos = 45;
    const cardWidth = 58, cardHeight = 22, gap = 6, startX = 14;

    doc.setFillColor(255, 243, 205); doc.setDrawColor(255, 238, 186);
    doc.roundedRect(startX, yPos, cardWidth, cardHeight, 3, 3, 'FD');
    doc.setTextColor(133, 100, 4);
    doc.setFontSize(22); doc.setFont("helvetica", "bold");
    doc.text(pendientes.toString(), startX + cardWidth / 2, yPos + 12, { align: 'center' });
    doc.setFontSize(8);
    doc.text("PENDIENTES (REZAGO)", startX + cardWidth / 2, yPos + 18, { align: 'center' });

    doc.setFillColor(212, 237, 218); doc.setDrawColor(195, 230, 203);
    doc.roundedRect(startX + cardWidth + gap, yPos, cardWidth, cardHeight, 3, 3, 'FD');
    doc.setTextColor(21, 87, 36);
    doc.setFontSize(22); doc.setFont("helvetica", "bold");
    doc.text(aprobados.toString(), startX + cardWidth + gap + cardWidth / 2, yPos + 12, { align: 'center' });
    doc.setFontSize(8);
    doc.text("APROBADOS", startX + cardWidth + gap + cardWidth / 2, yPos + 18, { align: 'center' });

    doc.setFillColor(248, 215, 218); doc.setDrawColor(245, 198, 203);
    doc.roundedRect(startX + (cardWidth + gap) * 2, yPos, cardWidth, cardHeight, 3, 3, 'FD');
    doc.setTextColor(114, 28, 36);
    doc.setFontSize(22); doc.setFont("helvetica", "bold");
    doc.text(observados.toString(), startX + (cardWidth + gap) * 2 + cardWidth / 2, yPos + 12, { align: 'center' });
    doc.setFontSize(8);
    doc.text("RECHAZADOS / OBSERVADOS", startX + (cardWidth + gap) * 2 + cardWidth / 2, yPos + 18, { align: 'center' });

    yPos += cardHeight + 15;

    doc.setTextColor(103, 58, 183);
    doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text("Desempeno por Validador", 14, yPos);
    yPos += 5;

    const rendimientoArray = Object.entries(rendimiento).map(([user, stats]) => ({
        user, ...stats, total: stats.aprobados + stats.observados
    })).sort((a, b) => b.total - a.total);

    const bodyRendimiento = rendimientoArray.map(r => [r.user, r.aprobados.toString(), r.observados.toString(), r.total.toString()]);
    if (bodyRendimiento.length === 0) bodyRendimiento.push(["Sin registros de validacion", "-", "-", "-"]);

    doc.autoTable({
        startY: yPos,
        head: [['Usuario (Validador)', 'Aprobados', 'Observados', 'Total Procesados']],
        body: bodyRendimiento,
        theme: 'striped',
        headStyles: { fillColor: [103, 58, 183] },
        styles: { fontSize: 10 },
        columnStyles: {
            1: { halign: 'center', textColor: [40, 167, 69],  fontStyle: 'bold' },
            2: { halign: 'center', textColor: [220, 53, 69],  fontStyle: 'bold' },
            3: { halign: 'center', fontStyle: 'bold' }
        }
    });

    yPos = doc.lastAutoTable.finalY + 15;
    if (yPos > 230) { doc.addPage(); yPos = 20; }

    doc.setTextColor(255, 126, 0);
    doc.setFontSize(12); doc.setFont("helvetica", "bold");
    doc.text("Mapa de Rezago (Pendientes por Estado)", 14, yPos);
    yPos += 5;

    const rezagoSorted = Object.entries(rezago).sort((a, b) => b[1] - a[1]);
    const bodyRezago = rezagoSorted.map(([estado, count]) => {
        let urgencia = "Normal";
        if (count > 25) urgencia = "Atencion";
        if (count > 75) urgencia = "Critico";
        return [estado, count.toString(), urgencia];
    });
    if (bodyRezago.length === 0) bodyRezago.push(["Sin rezago en ningun estado", "0", "-"]);

    doc.autoTable({
        startY: yPos,
        head: [['Estado', 'Circulos en Espera', 'Nivel de Urgencia']],
        body: bodyRezago,
        theme: 'grid',
        headStyles: { fillColor: [255, 126, 0] },
        styles: { fontSize: 10 },
        columnStyles: {
            1: { halign: 'center', fontStyle: 'bold', textColor: [133, 100, 4] },
            2: { halign: 'center', fontStyle: 'bold' }
        },
        didParseCell: function(data) {
            if (data.section === 'body' && data.column.index === 2) {
                if (data.cell.raw === 'Critico')  { data.cell.styles.textColor = [255,255,255]; data.cell.styles.fillColor = [220, 53, 69]; }
                if (data.cell.raw === 'Atencion') { data.cell.styles.textColor = [255,255,255]; data.cell.styles.fillColor = [255,126,  0]; }
                if (data.cell.raw === 'Normal')   { data.cell.styles.fillColor = [255,243,205]; }
            }
        }
    });

    doc.save(`Auditoria_Validacion_${Date.now()}.pdf`);
};

// ======================================================
// 8. ANALITICA DEL SERVIDOR (PDF)
// ======================================================

window.handleExportAnaliticaPDF = function() {
    if (!window.jspdf) { alert("Libreria PDF no cargada."); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ format: 'letter', unit: 'mm' });
    const pageWidth = 215.9;

    const logoMc = getLogoData('logoMC');
    if (logoMc) doc.addImage(logoMc, 'PNG', 14, 10, 20, 20);

    doc.setFillColor(23, 162, 184);
    doc.rect(0, 35, pageWidth, 2, 'F');

    doc.setTextColor(0);
    doc.setFontSize(18); doc.setFont("helvetica", "bold");
    doc.text("REPORTE DE RENDIMIENTO Y ANALITICA", 40, 20);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text(`Fecha del Diagnostico: ${new Date().toLocaleString('es-MX')}`, 40, 28);
    doc.text("Justificacion de Rendimiento de Servidor y Eficiencia", 40, 33);

    const { circles, users } = window.getAccessibleData
        ? window.getAccessibleData()
        : { circles: window.CRM.APP.circles, users: window.CRM.APP.users };

    let yPos = 45;

    // --- HEATMAP ---
    doc.setTextColor(211, 47, 47);
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Saturacion de Servidor (Heatmap de Registros por Hora)", 14, yPos);
    yPos += 5;

    const heatmap = Array(7).fill(0).map(() => Array(24).fill(0));
    let maxIntensity = 0;

    circles.forEach(c => {
        const dStr = c.timestamp || (c?.acta?.fecha ? c.acta.fecha + 'T12:00:00' : null);
        if (dStr) {
            const d = new Date(dStr);
            if (!isNaN(d)) {
                const day = d.getDay(), hr = d.getHours();
                heatmap[day][hr]++;
                if (heatmap[day][hr] > maxIntensity) maxIntensity = heatmap[day][hr];
            }
        }
    });

    const daysName = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
    const headRow  = ['Dia \\ Hora'];
    for (let h = 0; h < 24; h++) headRow.push(`${h}h`);

    const bodyHeatmap = [];
    for (let d = 0; d < 7; d++) {
        const row = [daysName[d]];
        for (let h = 0; h < 24; h++) row.push(heatmap[d][h] === 0 ? '' : heatmap[d][h].toString());
        bodyHeatmap.push(row);
    }

    doc.autoTable({
        startY: yPos,
        head: [headRow],
        body: bodyHeatmap,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1, halign: 'center' },
        columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 20 } },
        didParseCell: function(data) {
            if (data.section === 'body' && data.column.index > 0) {
                const val = parseInt(data.cell.raw);
                if (val > 0) {
                    const ratio = val / (maxIntensity || 1);
                    if      (ratio < 0.2) { data.cell.styles.fillColor = [255, 224, 178]; data.cell.styles.textColor = [0, 0, 0]; }
                    else if (ratio < 0.5) { data.cell.styles.fillColor = [255, 183,  77]; data.cell.styles.textColor = [0, 0, 0]; }
                    else if (ratio < 0.8) { data.cell.styles.fillColor = [255, 152,   0]; data.cell.styles.textColor = [255,255,255]; data.cell.styles.fontStyle = 'bold'; }
                    else                  { data.cell.styles.fillColor = [230,  81,   0]; data.cell.styles.textColor = [255,255,255]; data.cell.styles.fontStyle = 'bold'; }
                }
            }
        }
    });

    yPos = doc.lastAutoTable.finalY + 15;
    if (yPos > 240) { doc.addPage(); yPos = 20; }

    // --- RADAR DE OPERADORES ---
    doc.setTextColor(13, 71, 161);
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Radar de Operadores (Simuladores vs Guerreros)", 14, yPos);
    yPos += 5;

    const now2         = new Date();
    const thirty2      = new Date(); thirty2.setDate(now2.getDate() - 30);
    const seven2       = new Date(); seven2.setDate(now2.getDate() - 7);

    const performance = users.map(u => {
        const misC = circles.filter(c => c.coordinador_usuario === u.usuario);
        const recientes30 = misC.filter(c => {
            const fecha = c?.acta?.fecha;
            const d = new Date(c.timestamp || (fecha ? fecha + 'T12:00:00' : '1970-01-01'));
            return d >= thirty2;
        }).length;

        let lastConn = new Date(0);
        if (u.ultima_conexion && u.ultima_conexion !== '0000-00-00 00:00:00') {
            lastConn = new Date(u.ultima_conexion.replace(' ', 'T'));
        }

        let tag, colorRGB, textRGB;
        if (lastConn >= seven2 && recientes30 > 0)    { tag = 'Guerrero (Activo y Produce)';         colorRGB = [212,237,218]; textRGB = [21,87,36]; }
        else if (lastConn >= seven2)                   { tag = 'Simulador (Entra pero 0 Circulos)';   colorRGB = [255,243,205]; textRGB = [133,100,4]; }
        else if (recientes30 === 0)                    { tag = 'Fantasma (Ni entra ni produce)';      colorRGB = [248,215,218]; textRGB = [114,28,36]; }
        else                                           { tag = 'En Pausa (Produjo pero se ausento)';  colorRGB = [204,229,255]; textRGB = [0,64,133]; }

        const formatConn = lastConn.getTime() > 0 ? lastConn.toLocaleDateString('es-MX') : 'Desconocida';
        return { nombre: u.nombre, estado: u.estado, total: misC.length, recientes30, lastConnStr: formatConn, tag, colorRGB, textRGB };
    }).sort((a, b) => b.total - a.total);

    const bodyRadar = performance.map(p => [p.nombre, p.estado, p.lastConnStr, p.total.toString(), `+${p.recientes30}`, p.tag]);

    doc.autoTable({
        startY: yPos,
        head: [['Operador', 'Estado', 'Ult. Conexion', 'Circulos Totales', 'Nuevos 30 Dias', 'Diagnostico']],
        body: bodyRadar,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [50, 50, 50] },
        columnStyles: { 3: { halign: 'center' }, 4: { halign: 'center', fontStyle: 'bold' } },
        didParseCell: function(data) {
            if (data.section === 'body' && data.column.index === 5) {
                const rowData = performance[data.row.index];
                if (rowData) {
                    data.cell.styles.fillColor = rowData.colorRGB;
                    data.cell.styles.textColor = rowData.textRGB;
                    data.cell.styles.fontStyle = 'bold';
                }
            }
        }
    });

    doc.save(`Analitica_Servidor_${Date.now()}.pdf`);
};
