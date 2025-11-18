const { google } = require('googleapis');

// --- Configuración de Autenticación (Sin cambios) ---
function getAuth() {
  const credentials = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsAPI(auth) {
  return google.sheets({ version: 'v4', auth });
}

function getRowFromRange(range) {
  const match = range.match(/!([A-Z]+)(\d+)/);
  return match && match[2] ? parseInt(match[2], 10) : null;
}

// --- Funciones Auxiliares Existentes (Sin cambios graves) ---
async function findMechanicByName(sheets, name) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Hoja 1!A2:E' });
  const mechanics = mecsResponse.data.values || [];
  for (let i = 0; i < mechanics.length; i++) {
    if (mechanics[i][0]?.trim() === name?.trim()) {
      return {
        row: i + 2, name: mechanics[i][0], area: mechanics[i][1],
        availability: mechanics[i][2], status: mechanics[i][3], TareaActual_RowID: mechanics[i][4]
      };
    }
  }
  return null;
}

async function findMechanicActiveJob(sheets, name) {
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const jobsResponse = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: 'Hoja 1!M2:N' });
    const jobs = jobsResponse.data.values || [];
    for (let i = 0; i < jobs.length; i++) {
        if (jobs[i][0] === name && (jobs[i][1] === 'En Proceso' || jobs[i][1] === 'Asignado')) {
            return { row: i + 2, status: jobs[i][1] };
        }
    }
    return null;
}

async function findMechanicToAssign(sheets, area) {
  const spreadsheetId = process.env.MECANICOS_SHEET_ID;
  const mecsResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Hoja 1!A2:E' });
  const mechanics = mecsResponse.data.values || [];
  let freeMechanic = null;
  const normArea = area ? area.trim() : '';
  
  for (let i = 0; i < mechanics.length; i++) {
    const [name, assignedArea, availability, systemStatus] = mechanics[i];
    if (assignedArea?.trim() === normArea && availability === 'Disponible' && (!systemStatus || systemStatus === 'Libre')) {
        freeMechanic = { row: i + 2, name: name, area: assignedArea, status: 'Libre' };
        break; 
    }
  }
  return freeMechanic;
}

async function updateMechanicStatus(sheets, row, status, reportRowId) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.MECANICOS_SHEET_ID,
    range: `Hoja 1!D${row}:E${row}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[status, reportRowId || '']] },
  });
}

async function updateMechanicAvailability(sheets, name, availability) {
  const mechanic = await findMechanicByName(sheets, name); 
  if (!mechanic) throw new Error(`Mecánico ${name} no encontrado.`);
  
  const activeJob = await findMechanicActiveJob(sheets, name);
  let newStatusSistema = (availability === 'Disponible') ? (activeJob ? 'Ocupado' : 'Libre') : 'Ocupado';
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.MECANICOS_SHEET_ID,
    range: `Hoja 1!C${mechanic.row}:D${mechanic.row}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[availability, newStatusSistema]] },
  });
  mechanic.status = newStatusSistema;
  return mechanic;
}

// ... (Funciones de Cola Compartida y lógica de paros se mantienen igual, omitidas aquí por brevedad pero deben estar en tu archivo final) ...
// *NOTA: Asegúrate de NO borrar las funciones findNextJobInSharedQueue, reAssignPendingJob, findAndAssignNextJob, releaseAllJobs, checkForOpenDuplicate, getRowFromRange*
// Si necesitas el código completo de esas funciones dímelo, pero asumo que las mantendrás del archivo anterior.
// A CONTINUACIÓN REPLICO LAS FUNCIONES FALTANTES PARA QUE COPIES Y PEGUES TODO SEGURO:

async function checkForOpenDuplicate(sheets, area, maquina, estacion) {
  const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: 'Hoja 1!C2:N' });
  const jobs = response.data.values || [];
  const normArea = area ? area.trim() : '';
  const normMaquina = maquina ? maquina.trim() : '';
  const normEstacion = estacion ? estacion.trim() : '';

  for (const job of jobs) {
    if (job[0]?.trim() === normArea && job[1]?.trim() === normMaquina && job[2]?.trim() === normEstacion &&
        ['Asignado', 'En Proceso', 'En Cola'].includes(job[11]?.trim())) {
      return true; 
    }
  }
  return false;
}

async function findNextJobInSharedQueue(sheets, mechanicArea) {
  const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Hoja 1!C2:N' });
  const jobs = response.data.values || [];
  let highPriorityJob = null, lowPriorityJob = null;
  const normMechanicArea = mechanicArea ? mechanicArea.trim() : '';

  for (let i = 0; i < jobs.length; i++) {
    const row = i + 2;
    if (jobs[i][0]?.trim() === normMechanicArea && jobs[i][10] === 'En Espera' && jobs[i][11] === 'En Cola') {
      if (jobs[i][4] === 'detenida' && !highPriorityJob) { highPriorityJob = { row }; break; }
      if (jobs[i][4] === 'trabajando' && !lowPriorityJob) { lowPriorityJob = { row }; }
    }
  }
  return highPriorityJob || lowPriorityJob;
}

async function reAssignPendingJob(sheets, mechanic, jobRow) {
  await updateMechanicStatus(sheets, mechanic.row, 'Ocupado', jobRow);
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.MANTENIMIENTO_SHEET_ID,
    range: `Hoja 1!M${jobRow}:N${jobRow}`, 
    valueInputOption: 'USER_ENTERED',
    resource: { values: [[mechanic.name, 'Asignado']] },
  });
}

async function findAndAssignNextJob(sheets, mechanicName) {
  if (!mechanicName || mechanicName === 'En Espera') return;
  const mechanic = await findMechanicByName(sheets, mechanicName.trim()); 
  if (!mechanic) return;
  
  const nextJob = await findNextJobInSharedQueue(sheets, mechanic.area);
  if (nextJob) {
      await reAssignPendingJob(sheets, mechanic, nextJob.row);
  } else {
      await updateMechanicStatus(sheets, mechanic.row, 'Libre', '');
  }
}

async function releaseAllJobs(sheets, mechanicName) {
    const spreadsheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Hoja 1!M2:N' });
    const jobs = response.data.values || [];
    const jobsToRelease = [];
    for (let i = 0; i < jobs.length; i++) {
        if (jobs[i][0] === mechanicName && ['Asignado', 'En Proceso', 'En Cola'].includes(jobs[i][1])) {
            jobsToRelease.push(i + 2);
        }
    }
    if (jobsToRelease.length === 0) return;

    const dataForBatchUpdate = jobsToRelease.map(row => ({
        range: `Hoja 1!M${row}:N${row}`,
        values: [['En Espera', 'En Cola']],
    }));
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId, resource: { valueInputOption: 'USER_ENTERED', data: dataForBatchUpdate }
    });
}

// --- HANDLER PRINCIPAL (CON LA NUEVA LOGICA DE REGISTRO) ---
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  
  try {
    const { action, data, row, name, sessionRow } = JSON.parse(event.body); // Agregamos sessionRow
    const produccionSheetId = process.env.MANTENIMIENTO_SHEET_ID;
    const registrosSheetId = process.env.REGISTROS_SHEET_ID; // Nueva Variable
    
    if (!produccionSheetId) throw new Error('Falta configuración de hojas.');
    
    const auth = getAuth();
    const sheets = getSheetsAPI(auth);
    
    switch (action) {
      // ... (Casos 'abrir', 'cerrar', 'llegada', 'escalar_paro', 'check_status', 'get_mecanicos_activos' y 'get_mecanico_tareas' IGUAL QUE ANTES) ...
      // Por brevedad, pego solo los modificados y el resto asumo que los copias del anterior si no los has tocado. 
      
      case 'abrir': {
         // (Código original de abrir paro)
         if (!data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "data".' }) };
        const [fechaApertura, areaDelParo, maquinaDelParo, estacionDelParo, operador, statusMaquina, workOrder] = data;
        const isDuplicate = await checkForOpenDuplicate(sheets, areaDelParo, maquinaDelParo, estacionDelParo);
        if (isDuplicate) return { statusCode: 409, body: JSON.stringify({ error: 'Ya existe un reporte activo.' }) };

        const now = new Date();
        const folio = `MAN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const mechanicToAssign = await findMechanicToAssign(sheets, areaDelParo);
        let statusParo = mechanicToAssign ? 'Asignado' : 'En Cola';
        let mecanicoAsignado = mechanicToAssign ? mechanicToAssign.name : 'En Espera';
        
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: produccionSheetId, range: 'Hoja 1!A1', valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
          resource: { values: [[folio, ...data, '', '', '', '', mecanicoAsignado, statusParo]] },
        });
        const newRow = getRowFromRange(response.data.updates.updatedRange);
        if (mechanicToAssign) await updateMechanicStatus(sheets, mechanicToAssign.row, 'Ocupado', newRow);
        
        return { statusCode: 200, body: JSON.stringify({ row: newRow, status: statusParo, mecanico: mecanicoAsignado, folio: folio }) };
      }

      case 'cerrar': {
        // (Código original de cerrar paro)
        if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta datos.' }) };
        const getResponse = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: `Hoja 1!M${row}` });
        const mecanicoAsignadoOriginal = getResponse.data.values ? getResponse.data.values[0][0] : null;
        
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: produccionSheetId,
          resource: { valueInputOption: 'USER_ENTERED', data: [
              { range: `Hoja 1!I${row}:J${row}`, values: [[ data[0], data[1] ]] }, 
              { range: `Hoja 1!L${row}`, values: [[ data[2] ]] }, 
              { range: `Hoja 1!N${row}`, values: [['Cerrado']] } 
          ]}
        });
        if (mecanicoAsignadoOriginal && mecanicoAsignadoOriginal !== 'En Espera') await findAndAssignNextJob(sheets, mecanicoAsignadoOriginal);
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro finalizado.' }) };
      }
      
      case 'llegada': {
          if (!row || !data) return { statusCode: 400, body: JSON.stringify({ error: 'Falta datos.' }) };
          await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: produccionSheetId, resource: { valueInputOption: 'USER_ENTERED', data: [{ range: `Hoja 1!K${row}`, values: [data] }, { range: `Hoja 1!N${row}`, values: [['En Proceso']] }] } });
          return { statusCode: 200, body: JSON.stringify({ message: 'Llegada registrada.' }) };
      }

      case 'escalar_paro': {
        if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
        await sheets.spreadsheets.values.update({ spreadsheetId: produccionSheetId, range: `Hoja 1!G${row}`, valueInputOption: 'USER_ENTERED', resource: { values: [['detenida']] } });
        return { statusCode: 200, body: JSON.stringify({ message: 'Paro escalado.' }) };
      }

      case 'check_status': {
         if (!row) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "row".' }) };
         const response = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: `Hoja 1!G${row}:N${row}` });
         if (!response.data.values || !response.data.values[0]) throw new Error('No hay datos');
         const rowData = response.data.values[0];
         return { statusCode: 200, body: JSON.stringify({ mecanico: rowData[6] || 'N/A', status: rowData[7] || 'Abierto', statusMaquina: rowData[0] || 'trabajando' }) };
      }
      
      case 'get_mecanico_tareas': {
         // Copiar lógica original...
         // (Omito el código largo aquí para enfocarme en el cambio, usa el que tenías en get_mecanico_tareas)
         // ... Es idéntico al que tenías, no cambia por esta funcionalidad.
         // SOLO PARA QUE NO DE ERROR AL COPIAR, PEGO VERSIÓN RESUMIDA:
         if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
         const mechanic = await findMechanicByName(sheets, name);
         if (!mechanic) return { statusCode: 404, body: JSON.stringify({ error: 'Mecánico no encontrado.' }) };
         const normMechanicArea = mechanic.area ? mechanic.area.trim() : '';
         let tareaActual = null; const tareasEnCola = [];
         const response = await sheets.spreadsheets.values.get({ spreadsheetId: produccionSheetId, range: 'Hoja 1!A2:N' });
         const jobs = response.data.values || [];
         for (let i = 0; i < jobs.length; i++) {
             const r = i + 2; const [folio, , area, maquina, estacion, , statusM, , , , , , mec, statP] = jobs[i];
             if (!mec || !statP) continue;
             const t = { row: r, folio, area, maquina, estacion, statusParo: statP, statusMaquina: statusM };
             if (mec === name) {
                 if (statP === 'En Proceso') tareaActual = t;
                 else if (['Asignado', 'En Cola'].includes(statP)) { if(!tareaActual && statP==='Asignado') tareaActual = t; else tareasEnCola.push(t); }
             } else if (area?.trim() === normMechanicArea && mec === 'En Espera' && statP === 'En Cola') {
                 tareasEnCola.push(t);
             }
         }
         tareasEnCola.sort((a, b) => (a.statusMaquina === 'detenida' && b.statusMaquina !== 'detenida') ? -1 : 1);
         return { statusCode: 200, body: JSON.stringify({ tareaActual, tareasEnCola }) };
      }
      
      case 'get_mecanicos_activos': {
          const sId = process.env.MECANICOS_SHEET_ID;
          const mecsResponse = await sheets.spreadsheets.values.get({ spreadsheetId: sId, range: 'Hoja 1!A2:C' });
          const mechanics = mecsResponse.data.values || [];
          const activos = mechanics.filter(mec => mec[0] && mec[2] === 'Disponible').map(mec => mec[0]);
          return { statusCode: 200, body: JSON.stringify({ mecanicos: activos.sort() }) };
      }

      // --- AQUÍ ESTÁN LOS CAMBIOS IMPORTANTES ---

      case 'mecanico_check_in': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        // 1. Actualizar disponibilidad y buscar tarea (Lógica existente)
        const mechanic = await updateMechanicAvailability(sheets, name, 'Disponible');
        if (mechanic.status === 'Libre') await findAndAssignNextJob(sheets, mechanic.name);
        
        // 2. NUEVO: Registrar en Hoja "REGISTROS MECANICO"
        let newSessionRow = null;
        if (registrosSheetId) {
            const fechaEntrada = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const appendRes = await sheets.spreadsheets.values.append({
                spreadsheetId: registrosSheetId,
                range: 'Hoja 1!A1', // Asume que hay encabezados
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [[fechaEntrada, name]] } // Col A: Fecha, Col B: Nombre
            });
            newSessionRow = getRowFromRange(appendRes.data.updates.updatedRange);
        }

        return { 
            statusCode: 200, 
            body: JSON.stringify({ 
                message: `Check-in exitoso.`,
                sessionRow: newSessionRow // Devolvemos la fila para guardarla en el frontend
            }) 
        };
      }

      case 'mecanico_check_out': {
        if (!name) return { statusCode: 400, body: JSON.stringify({ error: 'Falta "name".' }) };
        
        // 1. Actualizar disponibilidad y liberar tareas (Lógica existente)
        const mechanic = await findMechanicByName(sheets, name);
        if (mechanic) {
            await releaseAllJobs(sheets, name);
            await sheets.spreadsheets.values.update({
                spreadsheetId: process.env.MECANICOS_SHEET_ID,
                range: `Hoja 1!C${mechanic.row}:E${mechanic.row}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values: [['No Disponible', 'Libre', '']] },
            });
        }

        // 2. NUEVO: Registrar salida en Hoja "REGISTROS MECANICO"
        if (registrosSheetId && sessionRow) {
            const fechaSalida = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            await sheets.spreadsheets.values.update({
                spreadsheetId: registrosSheetId,
                range: `Hoja 1!C${sessionRow}`, // Actualizamos Columna C de la fila guardada
                valueInputOption: 'USER_ENTERED',
                resource: { values: [[fechaSalida]] }
            });
        } else if (registrosSheetId && !sessionRow) {
             // Fallback: Si no hay sessionRow (ej. borró caché), al menos intentamos loguear un error o nada.
             console.log("Check-out sin referencia de sesión previa.");
        }

        return { statusCode: 200, body: JSON.stringify({ message: `Check-out exitoso.` }) };
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Acción desconocida.` }) };
    }
  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};