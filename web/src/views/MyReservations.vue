<template>
  <Layout>
    <h2 class="page-title">我的预约</h2>
    
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="success" class="alert alert-success">{{ success }}</div>
    
    <div class="card">
      <div v-if="reservations.length" class="reservation-list">
        <div v-for="r in reservations" :key="r.id" class="reservation-item">
          <div class="reservation-info">
            <div class="reservation-main">
              <span class="seat-number">{{ r.seat_number }}</span>
              <span class="zone-tag" :class="r.zone === 'silent' ? 'zone-silent' : 'zone-discussion'">
                {{ r.zone === 'silent' ? '静音区' : '讨论区' }}
              </span>
            </div>
            <div class="reservation-details">
              <span>📍 {{ r.room_name }}</span>
              <span>📅 {{ r.date }}</span>
              <span>⏰ {{ slotLabels[r.time_slot] }}</span>
            </div>
          </div>
          <button class="btn btn-danger" @click="cancelReservation(r.id)" :disabled="cancellingId === r.id">
            {{ cancellingId === r.id ? '取消中...' : '取消预约' }}
          </button>
        </div>
      </div>
      
      <div v-else class="empty">
        <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
        <p>暂无预约记录</p>
        <router-link to="/" class="btn btn-primary" style="margin-top: 16px;">去预约座位</router-link>
      </div>
    </div>
  </Layout>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Layout from '../components/Layout.vue'
import http from '../http'

const slotLabels = {
  morning: '上午 (08:00-12:00)',
  afternoon: '下午 (13:00-17:00)',
  evening: '晚上 (18:00-22:00)'
}

const reservations = ref([])
const error = ref('')
const success = ref('')
const cancellingId = ref(null)

async function loadReservations() {
  try {
    reservations.value = await http.get('/reservations/my')
  } catch (e) {
    error.value = '加载失败'
  }
}

async function cancelReservation(id) {
  if (!confirm('确定要取消这个预约吗？')) return
  cancellingId.value = id
  error.value = ''
  success.value = ''
  try {
    await http.delete(`/reservations/${id}`)
    success.value = '取消成功'
    await loadReservations()
  } catch (e) {
    error.value = e.error || '取消失败'
  } finally {
    cancellingId.value = null
  }
}

onMounted(loadReservations)
</script>

<style scoped>
.reservation-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.reservation-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  transition: all 0.2s;
}

.reservation-item:hover {
  border-color: #c7d2fe;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.reservation-info {
  flex: 1;
}

.reservation-main {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.seat-number {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.zone-tag {
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}

.zone-silent {
  background: #ede9fe;
  color: #6d28d9;
}

.zone-discussion {
  background: #dcfce7;
  color: #15803d;
}

.reservation-details {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 13px;
  color: #6b7280;
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: #9ca3af;
}
</style>
