<template>
  <div class="layout">
    <nav class="navbar">
      <div class="navbar-inner">
        <div class="navbar-brand">📚 考研自习室预约系统</div>
        <div class="navbar-links">
          <router-link to="/" class="nav-link">座位预约</router-link>
          <router-link to="/my" class="nav-link">我的预约</router-link>
          <router-link v-if="user?.role === 'admin'" to="/admin" class="nav-link">后台管理</router-link>
          <div class="user-info">
            <span class="username">{{ user?.username }}</span>
            <span v-if="user?.role === 'admin'" class="badge badge-admin">管理员</span>
            <button @click="logout" class="btn btn-secondary" style="padding: 6px 12px; font-size: 13px;">退出</button>
          </div>
        </div>
      </div>
    </nav>
    <div class="container" style="padding-top: 24px;">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const user = computed(() => JSON.parse(localStorage.getItem('user') || 'null'))

function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push('/login')
}
</script>
