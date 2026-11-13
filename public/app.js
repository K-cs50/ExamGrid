// Front end: jQuery for DOM + AJAX, talking to the Express API
var view = 'dashboard', cur = null, note = null;

function api(method, url, data) {
  return $.ajax({ url: '/api' + url, method: method, contentType: 'application/json',
                  data: data ? JSON.stringify(data) : undefined });
}
function say(kind, text) { note = [kind, text]; }
function noteHtml() { return note ? '<div class="note ' + note[0] + '" role="status">' + note[1] + '</div>' : ''; }
function head(title, sub, extra) {
  return '<div class="top"><div><h1>' + title + '</h1><p>' + sub + '</p></div><div class="row noprint">' + (extra || '') + '</div></div>';
}
function tag(t, c) { return '<span class="tag ' + (c || '') + '">' + t + '</span>'; }
function fail(x) { say('bad', (x.responseJSON && x.responseJSON.error) || 'Something went wrong'); draw(); }
function show(html) { $('#main').html(html); }

// ---------- views ----------
function dashboard() {
  api('GET', '/sessions').done(function (ss) {
    if (cur === null && ss.length) cur = ss[0].session_id;
    var done = ss.filter(function (s) { return s.allocated > 0; }).length;
    show(head('Dashboard', 'Sessions this week, one hall pool.') + noteHtml() +
      '<div class="stats"><div class="stat"><b>' + done + '/' + ss.length + '</b><span>sessions allocated</span></div></div>' +
      '<div class="panel"><h3>Exam sessions</h3><div class="wrap"><table><tr><th>Subject</th><th>Dept</th><th>Date and shift</th><th>Halls</th><th>Status</th><th></th></tr>' +
      ss.map(function (s) {
        return '<tr><td>' + s.subject + '</td><td>' + s.dept_id + '</td><td>' + s.exam_date + ', ' + s.shift + '</td><td>' + s.halls +
          '</td><td>' + (s.allocated ? tag('Allocated', 'ok') : tag('Pending', 'w')) +
          '</td><td><button class="btn sm" data-a="open" data-s="' + s.session_id + '">Open</button></td></tr>';
      }).join('') + '</table></div></div>');
  });
}

function allocation() {
  $.when(api('GET', '/sessions'), api('GET', '/faculty')).done(function (r1, r2) {
    var ss = r1[0], fac = r2[0];
    if (cur === null) cur = ss[0].session_id;
    api('GET', '/session/' + cur).done(function (d) {
      var s = d.session, out = head('Allocation', s.subject + ', ' + s.exam_date + ', ' + s.shift + ' (own dept ' + s.dept_id + ' is excluded)',
        '<button class="btn pri" data-a="alloc">Auto-allocate</button><button class="btn" data-a="clear">Clear</button>');
      out += '<div class="tabs noprint">' + ss.map(function (x) {
        return '<button class="btn' + (x.session_id == cur ? ' on' : '') + '" data-a="tab" data-s="' + x.session_id + '">' + x.subject + '</button>';
      }).join('') + '</div>' + noteHtml();

      var any = d.halls.some(function (h) { return h.people.length; });
      if (!any) { show(out + '<div class="panel empty">No invigilators assigned yet. Run auto-allocate to fill every hall, fewest duties first.</div>'); return; }

      out += '<div class="halls">' + d.halls.map(function (h) {
        return '<div class="hall"><header><b>' + h.hall_name + '</b><span>' + h.students + ' students, needs ' + h.needed + '</span></header>' +
          '<div class="desks" aria-hidden="true">' + new Array(Math.round(h.students / 3) + 1).join('<i></i>') + '</div>' +
          h.people.map(function (p) {
            var c = p.status === 'ABSENT' ? 'abs' : '';
            return '<div class="inv ' + c + '"><span>' + p.name + ' <em>' + p.dept_id + '</em></span>' +
              (p.status === 'ABSENT' ? '' : '<button class="btn sm" data-a="abs" data-id="' + p.alloc_id + '">Mark absent</button>') + '</div>';
          }).join('') + '</div>';
      }).join('') + '</div>';

      out += '<div class="panel"><h3>Reserve pool</h3>' + (d.reserves.length ? d.reserves.map(function (r) {
        return '<div class="inv res"><span>' + r.name + ' <em>' + r.dept_id + '</em></span><em>on standby</em></div>';
      }).join('') : '<div class="empty">No reserve left.</div>') + '</div>';

      out += '<div class="panel noprint"><h3>Manual override</h3><div class="row"><select id="mp">' +
        fac.map(function (f) { return '<option value="' + f.faculty_id + '">' + f.name + ' (' + f.dept_id + ')</option>'; }).join('') +
        '</select><select id="mh">' + d.halls.map(function (h) { return '<option value="' + h.session_hall_id + '">' + h.hall_name + '</option>'; }).join('') +
        '</select><button class="btn" data-a="add">Add invigilator</button></div></div>';
      show(out);
    });
  });
}

function chart() {
  api('GET', '/sessions').done(function (ss) {
    $.when.apply($, ss.map(function (s) { return api('GET', '/session/' + s.session_id); })).done(function () {
      var rs = ss.length === 1 ? [arguments] : arguments;
      var out = head('Duty chart', 'Print-ready, one table per session.', '<button class="btn pri" onclick="window.print()">Print chart</button>');
      for (var i = 0; i < ss.length; i++) {
        var d = rs[i][0], s = d.session;
        out += '<div class="panel"><h3>' + s.exam_date + ', ' + s.shift + ': ' + s.subject + ' (' + s.dept_id + ')</h3>';
        if (!d.halls.some(function (h) { return h.people.length; })) { out += '<div class="empty">Not allocated yet.</div></div>'; continue; }
        out += '<div class="wrap"><table><tr><th>Hall</th><th>Students</th><th>Invigilators</th></tr>' + d.halls.map(function (h) {
          return '<tr><td>' + h.hall_name + '</td><td>' + h.students + '</td><td>' +
            h.people.filter(function (p) { return p.status !== 'ABSENT'; }).map(function (p) { return p.name; }).join(', ') + '</td></tr>';
        }).join('') + '<tr><td>Reserve</td><td></td><td>' + d.reserves.map(function (r) { return r.name; }).join(', ') + '</td></tr></table></div></div>';
      }
      show(out);
    });
  });
}

function fairness() {
  api('GET', '/fairness').done(function (rows) {
    var mx = Math.max.apply(null, rows.map(function (r) { return r.base_duties + r.current; })) || 1;
    var mn = Math.min.apply(null, rows.map(function (r) { return r.base_duties + r.current; }));
    show(head('Fairness report', 'Total duties per faculty, earlier cycles included.') +
      '<div class="panel bars"><h3>Spread: ' + (mx - mn) + ' duties between busiest and lightest</h3>' + rows.map(function (r) {
        return '<div class="r"><span>' + r.name + '</span><div class="trk"><i style="width:' + (r.base_duties / mx * 100) + '%;background:#2E2E2E"></i>' +
          '<i style="width:' + (r.current / mx * 100) + '%;background:#fff"></i></div><b>' + (r.base_duties + r.current) + '</b></div>';
      }).join('') + '<p style="font-size:13px;color:var(--mute)">Gray: earlier duties. White: this cycle. Unused reserves get no credit.</p></div>');
  });
}

function avail() {
  api('GET', '/availability').done(function (d) {
    function off(f, s) { return d.un.some(function (u) { return u.faculty_id == f && u.session_id == s; }); }
    show(head('Availability', 'Tick the sessions a faculty member can’t cover.') +
      '<div class="panel"><div class="wrap"><table><tr><th>Faculty</th>' + d.sessions.map(function (s) { return '<th>' + s.exam_date + '<br>' + s.shift + '</th>'; }).join('') + '</tr>' +
      d.faculty.map(function (f) {
        return '<tr><td>' + f.name + ' <em style="color:var(--mute);font-style:normal">' + f.dept_id + '</em></td>' + d.sessions.map(function (s) {
          return '<td><input type="checkbox" data-a="un" data-f="' + f.faculty_id + '" data-s="' + s.session_id + '" aria-label="Unavailable"' + (off(f.faculty_id, s.session_id) ? ' checked' : '') + '></td>';
        }).join('') + '</tr>';
      }).join('') + '</table></div></div>');
  });
}

var views = { dashboard: dashboard, allocation: allocation, chart: chart, fairness: fairness, avail: avail };
function draw() {
  $('#nav button').removeClass('on').filter('[data-v="' + view + '"]').addClass('on');
  views[view]();
}

// ---------- events ----------
$('#nav').on('click', 'button', function () { view = $(this).data('v'); note = null; draw(); });

$('#main').on('click', '[data-a]', function () {
  var b = $(this), a = b.data('a');
  if (a === 'open') { cur = b.data('s'); view = 'allocation'; note = null; draw(); }
  else if (a === 'tab') { cur = b.data('s'); note = null; draw(); }
  else if (a === 'alloc') {
    api('POST', '/allocate/' + cur).done(function () { say('ok', 'Allocated by fewest duties first. Own-department and unavailable faculty were skipped.'); draw(); }).fail(fail);
  }
  else if (a === 'clear') { api('DELETE', '/allocate/' + cur).done(function () { note = null; draw(); }); }
  else if (a === 'abs') {
    api('POST', '/absent/' + b.data('id')).done(function () { say('w', 'Marked absent. The next reserve moved into that hall and the change was logged.'); draw(); }).fail(fail);
  }
  else if (a === 'add') {
    api('POST', '/assign', { session_id: cur, session_hall_id: +$('#mh').val(), faculty_id: +$('#mp').val() })
      .done(function () { say('ok', 'Invigilator added. All rules passed.'); draw(); }).fail(fail);
  }
  else if (a === 'un') {
    api('POST', '/unavailability', { faculty_id: b.data('f'), session_id: b.data('s'), on: b.is(':checked') });
  }
});

draw();
