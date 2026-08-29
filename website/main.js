/* global document, window, IntersectionObserver */

const header = document.querySelector('[data-site-header]')
const menuButton = document.querySelector('[data-menu-button]')
const menuLabel = document.querySelector('[data-menu-label]')
const navigation = document.querySelector('[data-navigation]')
const navigationLinks = navigation ? [...navigation.querySelectorAll('a')] : []
const tabButtons = [...document.querySelectorAll('[data-showcase-tab]')]
const tabPanels = [...document.querySelectorAll('[data-showcase-panel]')]
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

function updateHeader() {
  if (!header) return
  header.dataset.scrolled = String(window.scrollY > 12)
}

function closeMenu() {
  if (!menuButton || !navigation) return
  menuButton.setAttribute('aria-expanded', 'false')
  menuButton.setAttribute('aria-label', '打开导航菜单')
  if (menuLabel) menuLabel.textContent = '菜单'
  navigation.dataset.open = 'false'
  document.body.classList.remove('menu-open')
}

function toggleMenu() {
  if (!menuButton || !navigation) return
  const isOpen = menuButton.getAttribute('aria-expanded') === 'true'
  menuButton.setAttribute('aria-expanded', String(!isOpen))
  menuButton.setAttribute('aria-label', isOpen ? '打开导航菜单' : '关闭导航菜单')
  if (menuLabel) menuLabel.textContent = isOpen ? '菜单' : '关闭'
  navigation.dataset.open = String(!isOpen)
  document.body.classList.toggle('menu-open', !isOpen)
}

function activateShowcase(id, moveFocus = false) {
  const nextButton = tabButtons.find(button => button.dataset.showcaseTab === id)
  if (!nextButton) return

  tabButtons.forEach((button) => {
    const isActive = button === nextButton
    button.setAttribute('aria-selected', String(isActive))
    button.tabIndex = isActive ? 0 : -1
  })

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.showcasePanel === id
    panel.dataset.active = String(isActive)
    panel.setAttribute('aria-hidden', String(!isActive))
  })

  if (moveFocus) nextButton.focus()
}

tabButtons.forEach((button, index) => {
  button.addEventListener('click', () => activateShowcase(button.dataset.showcaseTab))
  button.addEventListener('keydown', (event) => {
    let nextIndex

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabButtons.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    activateShowcase(tabButtons[nextIndex].dataset.showcaseTab, true)
  })
})

if (menuButton) menuButton.addEventListener('click', toggleMenu)
navigationLinks.forEach(link => link.addEventListener('click', closeMenu))

window.addEventListener('scroll', updateHeader, { passive: true })
window.addEventListener('resize', () => {
  if (window.innerWidth > 1024) closeMenu()
})
updateHeader()

const revealItems = [...document.querySelectorAll('.reveal')]

if (reducedMotion.matches || !('IntersectionObserver' in window)) {
  revealItems.forEach(item => item.classList.add('is-visible'))
} else {
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    })
  }, {
    rootMargin: '0px 0px -10% 0px',
    threshold: 0.08,
  })

  revealItems.forEach(item => revealObserver.observe(item))
}
