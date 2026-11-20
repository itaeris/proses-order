<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CheckIcon, MinusIcon } from '@lucide/vue'
import { cn } from 'cn'

const props = defineProps<{
  checked?: boolean
  indeterminate?: boolean
  label: string
  class?: HTMLAttributes['class']
}>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : Boolean(checked)"
    :aria-label="label"
    :class="cn(
      'grid size-[18px] cursor-pointer place-items-center rounded-[5px] border shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
      checked || indeterminate ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted',
      props.class,
    )"
    @click="emit('toggle')"
  >
    <MinusIcon v-if="indeterminate" class="size-3" />
    <CheckIcon v-else-if="checked" class="size-3" />
  </button>
</template>
