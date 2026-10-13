'use strict';
const Acceso = (()=>{
  let csrf='', current=null, accounts=[];
  const roles={superadmin:'Superadministrador',admin:'Administrador',usuario:'Usuario'};
  const byId=id=>document.getElementById(id);
  const safe=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function request(route,method='GET',body) {
    if(method==='DELETE' && body===undefined)body={};
    const response=await fetch(`/api/acceso/${route}`,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error || 'No se pudo completar la solicitud.');
    if(data.csrf)csrf=data.csrf;
    return data;
  }
  function bind(id,action) {
    byId(id).addEventListener('submit',async event=>{
      event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"],button:not([type])');button.disabled=true;
      try{await action();}catch(error){if(byId('accessMessage')){byId('accessMessage').textContent=error.message;byId('accessMessage').hidden=false;}else toast(error.message);}
      finally{button.disabled=false;}
    });
  }
  async function loginPage() {
    if(!byId('loginForm'))return;
    try {
      const status=await request('estado');
      byId('setupForm').hidden=!status.requiere_configuracion;
      byId('loginForm').hidden=status.requiere_configuracion;
      document.querySelector('.login-subtitle').textContent=status.requiere_configuracion?'Registra las dos cuentas de los programadores para comenzar.':'Ingresa con la cuenta asignada a tu empresa.';
    }catch(error){byId('accessMessage').textContent=error.message;byId('accessMessage').hidden=false;}
    bind('loginForm',async()=>{await request('login','POST',Object.fromEntries(new FormData(byId('loginForm'))));location.href='/dashboard';});
    bind('setupForm',async()=>{
      const form=Object.fromEntries(new FormData(byId('setupForm')));
      await request('configurar','POST',{codigo:form.codigo,programadores:[1,2].map(i=>({nombre:form[`nombre${i}`],email:form[`email${i}`],password:form[`password${i}`]}))});
      location.href='/dashboard#configuraciones';
    });
  }
  async function loadUsers() {
    const users=await request('usuarios'); accounts=users;
    byId('accountList').innerHTML=users.length?`<div class="table-wrap"><table><thead><tr><th>Cuenta</th><th>Rol</th><th>Estado</th><th>Administrar</th></tr></thead><tbody>${users.map(u=>{
      const editable=u.rol!=='superadmin' && u.id!==current.usuario.id && (current.usuario.rol==='superadmin' || u.rol==='usuario');
      return `<tr><td><strong>${safe(u.nombre)}</strong><small>${safe(u.email)}</small></td><td>${safe(roles[u.rol])}</td><td>${u.activo?'Activo':'Desactivado'}</td><td>${editable?`<button class="secondary" data-account="${u.id}" data-active="${u.activo}" type="button">${u.activo?'Desactivar':'Activar'}</button> <button class="secondary" data-edit-account="${u.id}" data-role="${u.rol}" type="button">Editar cuenta</button> ${current.usuario.rol==='superadmin'?`<button class="secondary danger-button" data-delete-account="${u.id}" type="button">Eliminar</button>`:''}`:'—'}</td></tr>`;
    }).join('')}</tbody></table></div>`:'<p class="muted">Todavía no hay cuentas.</p>';
  }
  function companyName(name) {
    current.empresa.nombre=name;
    document.querySelector('.user-role').textContent=`${roles[current.usuario.rol]} · ${name}`;
    document.querySelector('.live-indicator').textContent=name;
    document.querySelector('.brand-name').textContent=name;
    byId('activeCompanyLabel').textContent=name;
    byId('currentViewSubtitle').textContent=`Servicios, unidades y recorridos · ${name}`;
    document.title=`${name} · Centro de control`;
    const footer=document.querySelector('main footer');if(footer)footer.firstChild.textContent=`${name} · Trujillo, Perú `;
    const selected=byId('companySelect').selectedOptions[0];if(selected)selected.textContent=name;
  }
  async function dashboard() {
    try{current=await request('yo');}catch{location.replace('/');return false;}
    const superadmin=current.usuario.rol==='superadmin', manager=superadmin || current.usuario.rol==='admin';
    document.querySelector('.user-name').textContent=current.usuario.nombre;
    document.querySelector('.user-role').textContent=`${roles[current.usuario.rol]} · ${current.empresa.nombre}`;
    document.querySelector('.user-avatar').textContent=current.usuario.nombre.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();
    document.querySelector('.live-indicator').textContent=current.empresa.nombre;
    document.querySelector('.user-profile-header').onclick=async event=>{event.preventDefault();try{await request('logout','POST',{});location.href='/';}catch(error){toast(error.message);}};
    document.querySelector('.user-profile-header').title='Cerrar sesión';
    byId('settingsForm').querySelectorAll('input,button').forEach(el=>{el.disabled=!manager;});
    byId('settingsPermission').textContent=manager?'Los cambios se aplican solo a la empresa seleccionada.':'Puedes consultar esta configuración. Solo el administrador puede modificarla.';
    byId('companyManagement').hidden=!superadmin;
    byId('userManagement').hidden=!manager;
    byId('accountRole').innerHTML=superadmin?'<option value="usuario">Usuario · trabajador</option><option value="admin">Administrador · dueño</option><option value="superadmin">Superadministrador · segundo programador</option>':'<option value="usuario">Usuario · trabajador</option>';
    byId('editAccountRole').innerHTML=superadmin?'<option value="usuario">Usuario · trabajador</option><option value="admin">Administrador · dueño</option>':'<option value="usuario">Usuario · trabajador</option>';
    byId('activeCompanyLabel').textContent=current.empresa.nombre;
    if(superadmin){
      const companies=await request('empresas');
      byId('companySelect').innerHTML=companies.map(c=>`<option value="${c.id}">${safe(c.nombre)}</option>`).join('');
      byId('companySelect').value=current.empresa.id;
      byId('companyList').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Empresa</th><th>Estado</th><th>Administrar</th></tr></thead><tbody>${companies.map(c=>`<tr><td><strong>${safe(c.nombre)}</strong><small>Empresa #${c.id}</small></td><td>${c.id===current.empresa.id?'Activa':'Disponible'}</td><td><button type="button" class="secondary" data-rename-company="${c.id}">Editar nombre</button> <button type="button" class="secondary danger-button" data-delete-company="${c.id}" ${c.id===current.empresa.id?'disabled':''}>Eliminar</button></td></tr>`).join('')}</tbody></table></div>`;
      byId('companyList').onclick=async event=>{
        const rename=event.target.closest('[data-rename-company]'), remove=event.target.closest('[data-delete-company]');
        const button=rename || remove;if(!button)return;
        const company=companies.find(c=>String(c.id)===(rename?rename.dataset.renameCompany:remove.dataset.deleteCompany));
        let body;
        if(rename){const nombre=prompt('Nombre de la empresa',company.nombre);if(nombre===null || !nombre.trim())return;body={nombre};}
        else if(!confirm(`¿Eliminar ${company.nombre}? Solo se pueden eliminar empresas sin cuentas ni datos operativos.`))return;
        button.disabled=true;
        try{await request(`empresas/${company.id}`,rename?'PATCH':'DELETE',body);location.reload();}catch(error){toast(error.message);button.disabled=false;}
      };
    }
    companyName(current.empresa.nombre);
    bind('switchCompanyForm',async()=>{await request('empresa-activa','POST',{empresa_id:Number(byId('companySelect').value)});location.reload();});
    bind('createCompanyForm',async()=>{
      const company=await request('empresas','POST',{nombre:byId('newCompanyName').value});
      await request('empresa-activa','POST',{empresa_id:company.id});location.reload();
    });
    bind('createAccountForm',async()=>{await request('usuarios','POST',Object.fromEntries(new FormData(byId('createAccountForm'))));byId('createAccountForm').reset();await loadUsers();toast('Cuenta creada.');});
    bind('passwordForm',async()=>{await request('password','PUT',Object.fromEntries(new FormData(byId('passwordForm'))));byId('passwordForm').reset();toast('Contraseña actualizada.');});
    bind('editAccountForm',async()=>{
      const form=Object.fromEntries(new FormData(byId('editAccountForm')));
      const body={rol:form.rol,nombre:form.nombre,email:form.email};if(form.password)body.password=form.password;
      await request(`usuarios/${byId('editAccountId').value}`,'PATCH',body);
      byId('accountDialog').close();await loadUsers();toast('Acceso actualizado.');
    });
    byId('accountList').onclick=async event=>{
      const toggle=event.target.closest('[data-account]'), edit=event.target.closest('[data-edit-account]');
      if(edit){byId('editAccountForm').reset();const user=accounts.find(u=>String(u.id)===edit.dataset.editAccount);byId('editAccountForm').elements.nombre.value=user.nombre;byId('editAccountForm').elements.email.value=user.email;byId('editAccountId').value=edit.dataset.editAccount;byId('editAccountRole').value=edit.dataset.role;byId('accountDialog').showModal();return;}
      const remove=event.target.closest('[data-delete-account]');
      if(remove){const user=accounts.find(u=>String(u.id)===remove.dataset.deleteAccount);if(!confirm(`¿Eliminar la cuenta de ${user.nombre}? Perderá el acceso definitivamente.`))return;remove.disabled=true;try{await request(`usuarios/${user.id}`,'DELETE');await loadUsers();toast('Cuenta eliminada.');}catch(error){toast(error.message);remove.disabled=false;}return;}
      if(!toggle)return;toggle.disabled=true;
      try{await request(`usuarios/${toggle.dataset.account}`,'PATCH',{activo:toggle.dataset.active!=='true'});await loadUsers();toast('Estado de la cuenta actualizado.');}catch(error){toast(error.message);toggle.disabled=false;}
    };
    if(manager)await loadUsers();
    return true;
  }
  document.addEventListener('DOMContentLoaded',loginPage);
  return {dashboard,companyName,get csrf(){return csrf;}};
})();
