document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('nav a[href^="#"]');
  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.main-navigation');

  links.forEach(link => {
    link.addEventListener('click', event => {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        navigation.classList.remove('active');
        menuButton.classList.remove('active');
      }
    });
  });

  if (menuButton) {
    menuButton.addEventListener('click', () => {
      navigation.classList.toggle('active');
      menuButton.classList.toggle('active');
    });
  }
});