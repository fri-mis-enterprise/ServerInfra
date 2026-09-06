clear
free -h
exit
free -h
exit
docker images n8nio/n8n
docker ps
sudo du -sh /var/lib/docker/
exit
sudo systemctl status sshd
clear
ip addr
clear
docker ps
clear
clear
sudo pacman -S docker docker-compose
clear
sudo systemctl enable --now docker
sudo systemctl status docker
docker version
docker compose version
clear
docker pull n8nio/n8n:latest
clear
docker run n8nio/n8n:latest
clear
docker ps -a
clear
mkdir -p ~/n8n
cd n8n/
pwd
sudo pacman -S neovim
clear
sudo nvim docker-compose.yml
cat docker-compose.yml 
docker compose up -d
clear
docker compose up -d
docker-compose version
pacman -Qs docker
sudo pacman -S docker-compose
docker compose up -d
clear
ip addr
clear
curl -I https://registry-1.docker.io/v2/
ip addr
clear
docker pull n8nio/n8n:latest
docker compose up -d
docker compose ps
docker compose ps
clear
ip addr
clear
cd
ip addr
free -h
clear
cd 
cd n8n/
clear
nvim docker-compose.yml 
docker compose down
docker compose up -d
clear
docker ps\
docker ps
clear
ls
clear
history
docker compose down
clear
sudo poweroff
clear
cd n8n/
clear
docker compose up -d
docker ps
ip addr
cd
mkdir IBS_Dumps
ls
cd IBS_Dumps/
mkdir Archives
mkdir Bienes
mkdir Filpride
mkdir Mcy
mkdir MMSI
mkdir Syvill
ls
clear
sudo pacman -Ss pg_dump
sudo pacman -Ss psql
sudo pacman -Ss postgres
sudo pacman -Sy postgresql-libs
pg_dump
clear
ls
ls Filpride/
ls Archives/
ls
clear
du Archives/
du Archives/ -h
clear
exit
clear
exit
clear
ls
clear
ls
clea
clear
clear
sudo nvim /etc/fstab 
sudo systemctl daemon-reload
clear
sudo mkdir /mnt/system3
sudo mkdir /mnt/fast_system
sudo mkdir /mnt/sql_database
sudo systemctl daemon-reload
ls /mnt/system3/
sudo mount -a
ls /mnt/system3/
clear
sudo systemctl daemon-reload
ls /mnt/system3/
clear
which mount
sudo pacman -S mount
clear
ls
which mount
whereis mount
clear
sudo visudo
EDITOR=nvim sudo visudo
EDITOR=nvim sudo visudo
clear
EDITOR=nvim sudo visudo
sudo mount
clear
exit
sudo mount
clear
which mount
whereis mount
whereis umount
EDITOR=nvim sudo visudo
EDITOR=nvim sudo visudo -f /etc/sudoers.d/99-mis-mount
clear
sudo mount
clear
sudo mount
sudo mount
clear
sudo mount
sudo pacman -S
clear
sudo pacman -S zip
sudo pacman -S unzip
ip addr
clear
free -h
clear
ip addr
clear
ip addr
clear
cat n8n/docker-compose.yml 
clear
nvim n8n/docker-compose.yml 
docker network create proxy
docker compose down
cd n8n/
clear
docker compose down
nvim 
clear
nvim docker-compose.yml 
docker compose up -d
docker network ls
docker compose -f docker-compose.yml ps
docker network inspect proxy
clear
cd
mkdir -p ~/caddy
clear
ls
cd caddy/
clear
nvim docker-compose.yml
touch Caddyfile
nvim 
nvim docker-compose.yml 
nvim Caddyfile 
docker compose up -d
docker logs caddy
docker compose ps
docker logs caddy
clear
docker compose logs caddy
curl -I http://192.168.0.254
clear
curl -k -I https://192.168.0.254
clear
nvim Caddyfile 
docker compose restart
curl -I http://192.168.0.254
curl -I http://192.168.0.254
clear
curl -I http://192.168.0.254
clear
curl -I http://192.168.0.254
curl -I http://192.168.0.254
sudo ss -tlnp | grep ':80'
sudo ufw
docker compose ps
clear
ping 192.168.0.254:80
ping 192.168.0.254 -p 80
clear
curl -v http://192.168.0.254
clear
ls
nvim Caddyfile 
nvim docker-compose.yml 
docker compose down
docker compose up -d
docker compose ps
nvim docker-compose.yml 
curl -IL http://192.168.0.254
cat ~/caddy/Caddyfile
curl -v http://192.168.0.254
clear
nvim docker-compose.yml 
nvim Caddyfile 
docker compose down
docker compose up -d
curl -kI https://192.168.0.254
curl -kI https://192.168.0.254
clear
cd ~/caddy
docker compose logs --tail=100 caddy
clear
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
cat Caddyfile
clea
clear
docker compose exec caddy ls -l /data/caddy/certificates/local/
docker compose exec caddy find /data/caddy/pki -type f -maxdepth 5
docker compose exec caddy caddy list-modules | grep pki
openssl s_client -connect 192.168.0.254:443 -servername 192.168.0.254
clear
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > ~/caddy/root.crt
ls -l ~/caddy/root.crt
exit
docker compose ps
cd caddy/
clear
docker compose ps
sudo ss -lntp | grep -E ':80|:443'
curl -v http://192.168.0.254
curl -vk https://192.168.0.254
docker compose logs --tail=50 caddy
clear
docker compose exec caddy find /data/caddy/certificates/local/192.168.0.254 -type f -ls
cd caddy/
clear
clear
docker compose exec caddy find /data/caddy/certificates/local/192.168.0.254 -type f -ls
docker compose exec caddy ls -la /data/caddy/certificates/local/192.168.0.254
docker compose exec caddy sh -c 'for f in /data/caddy/certificates/local/192.168.0.254/*; do echo "=== $f ==="; ls -l "$f"; done'
clear
docker compose exec caddy sh -c 'cat /data/caddy/certificates/local/192.168.0.254/192.168.0.254.json'
docker compose exec caddy caddy list-certificates
docker compose exec caddy openssl x509   -in /data/caddy/certificates/local/192.168.0.254/192.168.0.254.crt   -noout -subject -issuer -dates -text
nvim Caddyfile 
docker compose restart caddy
curl --http1.1 -vk https://192.168.0.254
curl --http1.1 -vk https://192.168.0.254
clear
docker compose logs --tail=100 caddy
clear
openssl s_client   -connect 192.168.0.254:443   -servername 192.168.0.254   </dev/null
clear
cat Caddyfile
clear
openssl s_client   -connect 192.168.0.254:443   -servername 192.168.0.254   </dev/null
nvim Caddyfile 
docker compose restart caddy
clear
docker compose restart caddy
nvim Caddyfile 
curl --http1.1 -vk https://192.168.0.254
clear
nvim Caddyfile 
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose restart caddy
curl --http1.1 -vk https://192.168.0.254
clear
nvim Caddyfile 
clear
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose restart caddy
curl -kI https://192.168.0.254/n8n/
cd
cd n8n/
clear
nvim docker-compose.yml 
docker compose up -d
lsblk -f
sudo fdisk -l
exit
clear
lsblk
sudo growpart /dev/sda 2
sudo pacman -S cloud-guest-utils
sudo growpart /dev/sda 2
clear
lsblk
sudo btrfs filesystem resize max /
df -h /
ip addr
clear
clear
ip addr
clear
ip addr
clear
git status
clear
git
sudo pacman -S git
clear
free -h
clear
sudo pacman -S samba
clear
ls
nvim /etc/samba/smb.conf
sudo nvim /etc/samba/smb.conf
sudo systemctl restart smb
ls -ld /home/mis /home/mis/IBS_Dumps
sudo chmod 711 /home/mis
sudo chmod -R a+rX /home/mis/IBS_Dumps
sudo systemctl restart smb
testparm -s
sudo systemctl status smb --no-pager
sudo smbclient -L localhost -N
grep -A10 '^\[IBS_Dumps\]' /etc/samba/smb.conf
smbclient //localhost/IBS_Dumps -N -c 'ls'
sudo systemctl enable smb
sudo ss -tulpn | grep -E ':(445|139)\b'
clear
sudo nvim /etc/samba/smb.conf
sudo smbpass -a mis
sudo smbpasswd -a mis
sudo systemctl restart smb
clear
ls
cd caddy/
ls
nvim Caddyfile 
docker compose reload caddy
clear
docker compose restart caddy
cd ..
nvim README.md
git status
git init
sudo pacman -S git
sudo pacman -S git
clear
exit
sudo pacman -S git
clear
EDITOR=nvim sudo visudo
exit
