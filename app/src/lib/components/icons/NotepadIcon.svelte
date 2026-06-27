<script lang="ts">
  export let size = 14;
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <!-- Pad body -->
  <rect
    x="3"
    y="2.5"
    width="10"
    height="11.5"
    rx="1.5"
    stroke="currentColor"
    stroke-width="1.2"
  />
  <!-- Top binder strip -->
  <path
    d="M5.5 1.5v1.4M8 1.5v1.4M10.5 1.5v1.4"
    stroke="currentColor"
    stroke-width="1.2"
    stroke-linecap="round"
  />
  <!-- Text lines -->
  <path
    d="M5.5 7h5M5.5 9.5h5M5.5 12h3"
    stroke="currentColor"
    stroke-width="1.2"
    stroke-linecap="round"
  />
</svg>
