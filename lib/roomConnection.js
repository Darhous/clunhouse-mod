'use strict';
const fail = (status, text) => Object.assign(new Error(text), { status, stopOperation: true });

// Identical concurrent clicks share one transition; different transitions cannot race.
function createRoomConnection({ poller, getProfile, join, leave, now = Date.now }) {
  let active = null, recentJoin = null;
  function run(key, work) {
    const profile = getProfile(), generation = poller.getContext();
    if (active) {
      if (active.key === key && active.profile === profile && active.generation === generation) return active.promise;
      return Promise.reject(fail(409, 'في تغيير لاتصال الغرفة جاري؛ استنى اكتماله'));
    }
    const entry = { key, profile, generation };
    const validate = () => {
      if (getProfile() !== profile || poller.getContext() !== generation) throw fail(409, 'اتغير الحساب أو اتصال الغرفة أثناء الطلب؛ حدّث الحالة');
    };
    entry.promise = Promise.resolve().then(() => work(validate, profile, generation)).finally(() => { if (active === entry) active = null; });
    active = entry;
    return entry.promise;
  }
  return {
    join(channel) {
      return run(`join:${channel}`, async (validate, profile, generation) => {
        validate();
        const room = poller.getState();
        if ((room.channel === channel && room.connected && room.self?.isInRoom) ||
            (recentJoin?.channel === channel && recentJoin.profile === profile && recentJoin.generation === generation && now() - recentJoin.time < 5000)) {
          poller.start(channel, { keepAlive: true });
          return { success: true, alreadyJoined: true };
        }
        const result = await join(channel);
        validate();
        if (result?.success !== true) throw fail(502, result?.error_message || 'لم يؤكد Clubhouse الانضمام');
        poller.start(channel, { keepAlive: true });
        recentJoin = { channel, profile, generation: poller.getContext(), time: now() };
        return result;
      });
    },
    select(channel) { return run(`select:${channel}`, (validate) => { validate(); poller.start(channel); }); },
    leave(channel) {
      return run(`leave:${channel}`, async (validate) => {
        validate();
        const result = await leave(channel);
        validate();
        if (result?.success !== true) throw fail(502, result?.error_message || 'لم يؤكد Clubhouse المغادرة');
        poller.stop(); recentJoin = null;
        return result;
      });
    },
  };
}
module.exports = { createRoomConnection };
